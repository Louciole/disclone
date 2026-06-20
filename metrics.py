"""Semantic layer for computed (live-metric) databases.

A "computed" note_database renders the result of a declarative *MetricSpec*,
compiled to a parameterized aggregate query and evaluated fresh at read time
(Path B — live, no history).

Design (see also routes/workspaces.py):

    [1] Analytics views (db/schema.sql) — joins + derived fields, NO PII columns
    [2] Catalog (DATASETS, below)       — declares safe dimensions/measures/filters
    [3] Compiler (compile_spec)         — MetricSpec -> SQL + bind params
    [4] Builder (static/.../database.mjs)

SAFETY (enforced in compile_spec, fail-closed):
  * No raw rows — every query aggregates; >=1 measure required.
  * No PII — PII is absent from the views/catalog (omission) + a deny tripwire.
  * Keys validated — only catalog keys are accepted; unknown -> SpecError.
  * Values parameterized — filter values are bind params, never interpolated.
  * k-anonymity — grouping by a `sensitive` dimension suppresses groups < k.
  * Bounded cost — dimension cap, LIMIT cap, statement_timeout at run time.

The SQL fragments inside Dim/Measure/Filter are author-written CONSTANTS — they
are the trusted part. The only attacker-controlled inputs are (a) which keys,
checked against the catalog, and (b) filter values, sent as %s parameters.

Provider datasets: a Dataset may instead carry a Python `provider(srv)` that
returns a fixed snapshot (columns, rows) — used for host/infra telemetry
(CPU/RAM/disk/storage) that doesn't live in SQL. They take no dimensions or
measures and are still admin-only.
"""
import os


# ─── Catalog primitives ───────────────────────────────────────────────

class Dim:
    """A group-by-able field. `sql` is a trusted SQL expression constant."""
    def __init__(self, sql, type="text", label=None, sensitive=False):
        self.sql = sql
        self.type = type
        self.label = label
        self.sensitive = sensitive


class Measure:
    """An aggregate. `sql` is a trusted aggregate expression constant."""
    def __init__(self, sql, type="number", label=None):
        self.sql = sql
        self.type = type
        self.label = label


class Filter:
    """A whitelisted filter on `column` (trusted constant) with allowed ops."""
    def __init__(self, column, type="text", ops=("eq",)):
        self.column = column
        self.type = type
        self.ops = tuple(ops)


class Dataset:
    def __init__(self, source=None, dimensions=None, measures=None, filters=None,
                 k_anon=0, label=None, provider=None):
        self.source = source            # trusted view/table name constant
        self.dimensions = dimensions or {}
        self.measures = measures or {}
        self.filters = filters or {}
        self.k_anon = k_anon
        self.label = label
        self.provider = provider        # callable(srv) -> (cols_meta, rows) | None


class SpecError(Exception):
    """Raised when a MetricSpec is invalid or unsafe."""


# ─── Limits & operators ───────────────────────────────────────────────

MAX_DIMENSIONS = 3
MAX_LIMIT = 1000
DEFAULT_LIMIT = 100
STATEMENT_TIMEOUT = "5s"

# Binary comparison ops -> SQL operator. `last_days` is handled specially.
_BINARY_OPS = {
    "eq": "=", "ne": "<>",
    "gte": ">=", "gt": ">", "lte": "<=", "lt": "<",
}

# Tripwire: identifiers that must never appear in a catalog SQL fragment.
# The catalog/views already omit PII; this catches authoring mistakes.
_PII_DENY = ("password", "email", "token", "dkim", "secret", "api_key",
             "body", "pfp", "banner")


# ─── Catalog (the single auditable list of what is analyzable) ─────────

DATASETS = {
    "overview": Dataset(
        label="Platform overview",
        source="analytics_overview",
        dimensions={},
        measures={
            "users":        Measure("max(users)",        label="Users"),
            "servers":      Measure("max(servers)",      label="Servers"),
            "messages":     Measure("max(messages)",     label="Messages"),
            "active_calls": Measure("max(active_calls)", label="Active calls"),
        },
    ),
    "users": Dataset(
        label="Users / signups",
        source="analytics_users",
        dimensions={
            "day":     Dim("date_trunc('day', inscription)",  type="date", label="Day"),
            "week":    Dim("date_trunc('week', inscription)", type="date", label="Week"),
            "faction": Dim("faction", type="text", label="Faction", sensitive=True),
        },
        measures={
            "count": Measure("count(*)", label="Signups"),
        },
        filters={
            "since": Filter("inscription", type="date", ops=("gte", "lt", "last_days")),
        },
        k_anon=5,
    ),
    "messages": Dataset(
        label="Messages",
        source="analytics_messages",
        dimensions={
            "day":    Dim("date_trunc('day', timestamp)",  type="date",   label="Day"),
            "week":   Dim("date_trunc('week', timestamp)", type="date",   label="Week"),
            "server": Dim("server", type="number", label="Server id"),
        },
        measures={
            "count":   Measure("count(*)",               label="Messages"),
            "senders": Measure("count(distinct sender)", label="Unique senders"),
        },
        filters={
            "since": Filter("timestamp", type="date", ops=("gte", "lt", "last_days")),
        },
    ),
    "servers": Dataset(
        label="Server health",
        source="analytics_servers",
        dimensions={
            "server": Dim("name", type="text", label="Server"),
        },
        measures={
            "members":    Measure("max(member_count)", label="Members"),
            "storage_mb": Measure("round(max(storage_usage) / 1048576.0, 1)", label="Storage (MB)"),
        },
    ),
    "calls": Dataset(
        label="Calls",
        source="analytics_calls",
        dimensions={
            "type": Dim("call_type", type="text",   label="Type"),
            "mode": Dim("mode",      type="text",   label="Mode"),
            "day":  Dim("date_trunc('day', started_at)", type="date", label="Day"),
        },
        measures={
            "count":  Measure("count(*)",                  label="Total"),
            "active": Measure("count(*) FILTER (WHERE active)", label="Active"),
        },
        filters={
            "since": Filter("started_at", type="date", ops=("gte", "lt", "last_days")),
        },
    ),
}


# ─── Provider datasets (host / infra telemetry, not in SQL) ────────────

def _human_bytes(n):
    n = float(n or 0)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024


def _scalar(srv, sql):
    try:
        r = srv.db._do(lambda c: c.execute(sql).fetchone())
        return r if r else None
    except Exception as e:
        print(f"[METRICS] scalar query failed: {e}")
        return None


def _provider_system_resources(srv):
    """Live host gauges: CPU, RAM, disk for the attachments partition."""
    cols = [{"name": "Metric", "type": "text"}, {"name": "Value", "type": "text"}]
    rows = []
    try:
        import psutil
        vm = psutil.virtual_memory()
        rows.append(["CPU load", f"{psutil.cpu_percent(interval=1.0):.0f} %"])
        rows.append(["RAM used", f"{vm.used / 1073741824:.1f} / "
                                 f"{vm.total / 1073741824:.1f} GB ({vm.percent:.0f} %)"])
    except Exception:
        rows.append(["CPU load", "n/a (psutil not installed)"])
        rows.append(["RAM used", "n/a (psutil not installed)"])
    try:
        import shutil
        base = getattr(srv, "path", ".") or "."
        path = os.path.join(base, "static", "attachments")
        if not os.path.isdir(path):
            path = base
        du = shutil.disk_usage(path)
        pct = du.used / du.total * 100 if du.total else 0
        rows.append(["Disk used", f"{du.used / 1073741824:.1f} / "
                                  f"{du.total / 1073741824:.1f} GB ({pct:.0f} %)"])
        rows.append(["Disk free", f"{du.free / 1073741824:.1f} GB"])
    except Exception as e:
        rows.append(["Disk", f"n/a ({e})"])
    return cols, rows


def _provider_storage(srv):
    """Storage footprint: DB size, files on disk, quota usage totals."""
    cols = [{"name": "Metric", "type": "text"}, {"name": "Value", "type": "text"}]
    rows = []
    r = _scalar(srv, "select pg_size_pretty(pg_database_size(current_database())) as s")
    rows.append(["Database size", r["s"] if r else "n/a"])
    r = _scalar(srv, "select coalesce(sum(size), 0) as s, count(*) as c from drive_file")
    rows.append(["Files stored", _human_bytes(r["s"]) if r else "n/a"])
    rows.append(["File count", str(r["c"]) if r else "n/a"])
    r = _scalar(srv, "select coalesce(sum(storage_usage), 0) as s from mycelium_account")
    rows.append(["User storage used", _human_bytes(r["s"]) if r else "n/a"])
    r = _scalar(srv, "select coalesce(sum(storage_usage), 0) as s from server")
    rows.append(["Server storage used", _human_bytes(r["s"]) if r else "n/a"])
    return cols, rows


DATASETS["system_resources"] = Dataset(
    label="Server resources (live)",
    provider=_provider_system_resources,
)
DATASETS["storage"] = Dataset(
    label="Storage usage",
    provider=_provider_storage,
)


# ─── Named presets (blessed starting specs over the catalog) ───────────

METRIC_PRESETS = {
    "overview": {
        "name": "Platform overview",
        "spec": {"dataset": "overview",
                 "measures": ["users", "servers", "messages", "active_calls"]},
    },
    "signups_7d": {
        "name": "Signups (last 7 days)",
        "spec": {"dataset": "users", "dimensions": ["day"], "measures": ["count"],
                 "filters": [{"field": "since", "op": "last_days", "value": 7}],
                 "order": [{"by": "day", "dir": "asc"}]},
    },
    "messages_7d": {
        "name": "Messages (last 7 days)",
        "spec": {"dataset": "messages", "dimensions": ["day"], "measures": ["count", "senders"],
                 "filters": [{"field": "since", "op": "last_days", "value": 7}],
                 "order": [{"by": "day", "dir": "asc"}]},
    },
    "server_health": {
        "name": "Server health (top 20)",
        "spec": {"dataset": "servers", "dimensions": ["server"],
                 "measures": ["members", "storage_mb"],
                 "order": [{"by": "members", "dir": "desc"}], "limit": 20},
    },
    "calls_overview": {
        "name": "Calls by type & mode",
        "spec": {"dataset": "calls", "dimensions": ["type", "mode"],
                 "measures": ["count", "active"],
                 "order": [{"by": "count", "dir": "desc"}]},
    },
    "system_resources": {
        "name": "Server resources (live)",
        "spec": {"dataset": "system_resources"},
    },
    "storage": {
        "name": "Storage usage",
        "spec": {"dataset": "storage"},
    },
}


# ─── Compiler ─────────────────────────────────────────────────────────

def _check_fragment(frag):
    low = frag.lower()
    for bad in _PII_DENY:
        if bad in low:
            raise SpecError(f"forbidden identifier in catalog fragment: {bad}")


def compile_spec(spec):
    """Compile a MetricSpec into (sql, params, columns, aliases).

    columns: list of {name, type} in output order.
    aliases: result-row dict keys in the same order (d0, d1, ..., m0, ...).
    Raises SpecError on anything invalid or unsafe.
    """
    if not isinstance(spec, dict):
        raise SpecError("spec must be an object")

    ds = DATASETS.get(spec.get("dataset"))
    if ds is None:
        raise SpecError("unknown dataset")

    dims = spec.get("dimensions") or []
    meas = spec.get("measures") or []
    if not isinstance(dims, list) or not isinstance(meas, list):
        raise SpecError("dimensions/measures must be lists")
    if not meas:
        raise SpecError("at least one measure is required (no raw rows)")
    if len(dims) > MAX_DIMENSIONS:
        raise SpecError("too many dimensions")

    select = []
    aliases = []
    columns = []
    sensitive_grouping = False

    for i, dk in enumerate(dims):
        d = ds.dimensions.get(dk)
        if d is None:
            raise SpecError(f"unknown dimension: {dk}")
        _check_fragment(d.sql)
        alias = f"d{i}"
        select.append(f"{d.sql} AS {alias}")
        aliases.append(alias)
        columns.append({"name": d.label or dk, "type": d.type})
        sensitive_grouping = sensitive_grouping or d.sensitive

    for j, mk in enumerate(meas):
        m = ds.measures.get(mk)
        if m is None:
            raise SpecError(f"unknown measure: {mk}")
        _check_fragment(m.sql)
        alias = f"m{j}"
        select.append(f"{m.sql} AS {alias}")
        aliases.append(alias)
        columns.append({"name": m.label or mk, "type": m.type})

    params = []
    where = []
    for f in (spec.get("filters") or []):
        fdef = ds.filters.get(f.get("field"))
        if fdef is None:
            raise SpecError(f"unknown filter: {f.get('field')}")
        op = f.get("op")
        if op not in fdef.ops:
            raise SpecError(f"filter op not allowed: {op}")
        _check_fragment(fdef.column)
        if op == "last_days":
            try:
                days = int(f.get("value", 0))
            except (TypeError, ValueError):
                raise SpecError("last_days value must be an integer")
            where.append(f"{fdef.column} >= current_date - (%s::int) * interval '1 day'")
            params.append(days)
        else:
            where.append(f"{fdef.column} {_BINARY_OPS[op]} %s")
            params.append(f.get("value"))

    sql = "SELECT " + ", ".join(select) + " FROM " + ds.source
    if where:
        sql += " WHERE " + " AND ".join(where)
    if dims:
        sql += " GROUP BY " + ", ".join(str(i + 1) for i in range(len(dims)))
        if ds.k_anon and sensitive_grouping:
            sql += f" HAVING count(*) >= {int(ds.k_anon)}"

    alias_set = set(aliases)
    by_key = {}
    for i, dk in enumerate(dims):
        by_key[dk] = f"d{i}"
    for j, mk in enumerate(meas):
        by_key[mk] = f"m{j}"
    order_parts = []
    for o in (spec.get("order") or []):
        a = by_key.get(o.get("by"))
        if a is None or a not in alias_set:
            raise SpecError(f"unknown order field: {o.get('by')}")
        direction = "desc" if str(o.get("dir", "asc")).lower() == "desc" else "asc"
        order_parts.append(f"{a} {direction}")
    if order_parts:
        sql += " ORDER BY " + ", ".join(order_parts)
    elif dims:
        sql += " ORDER BY 1"

    try:
        limit = int(spec.get("limit", DEFAULT_LIMIT))
    except (TypeError, ValueError):
        limit = DEFAULT_LIMIT
    limit = max(1, min(limit, MAX_LIMIT))
    sql += f" LIMIT {limit}"

    return sql, params, columns, aliases


# ─── Runtime ──────────────────────────────────────────────────────────

def _fmt(v):
    return "" if v is None else str(v)


def _synth(cols_meta, data_rows):
    """Build the get_database_content-shaped dict from columns + row tuples."""
    columns = [
        {"id": i + 1, "name": c["name"], "type": c["type"],
         "position": (i + 1) * 0.1, "options": "{}"}
        for i, c in enumerate(cols_meta)
    ]
    rows = []
    cells = {}
    for ri, values in enumerate(data_rows or []):
        row_id = ri + 1
        rows.append({"id": row_id, "position": row_id * 0.1})
        cells[str(row_id)] = {
            str(columns[ci]["id"]): _fmt(v) for ci, v in enumerate(values)
        }
    return {"columns": columns, "rows": rows, "cells": cells}


def validate_spec(spec):
    """Raise SpecError unless the spec is a valid SQL spec or a provider dataset."""
    ds = DATASETS.get(spec.get("dataset")) if isinstance(spec, dict) else None
    if ds is not None and ds.provider is not None:
        return
    compile_spec(spec)


def run_spec(srv, spec):
    """Evaluate a spec, returning a get_database_content-shaped dict.

    `srv` is the live Mycelium server (has `.db` and `.path`). Provider datasets
    return a host/infra snapshot; everything else compiles to aggregate SQL.
    Synthesizes stable sequential ids so the frontend renders it unchanged.
    Raises SpecError if a SQL spec is invalid.
    """
    if not isinstance(spec, dict):
        raise SpecError("spec must be an object")

    ds = DATASETS.get(spec.get("dataset"))
    if ds is not None and ds.provider is not None:
        try:
            cols_meta, data_rows = ds.provider(srv)
        except Exception as e:
            print(f"[METRICS] provider failed: {e}")
            cols_meta, data_rows = [], []
        return _synth(cols_meta, data_rows)

    sql, params, cols_meta, aliases = compile_spec(spec)

    def _exec(conn):
        # SET does not accept bind params; set_config(..., is_local=true) does
        # the same as SET LOCAL and is parameter-safe.
        conn.execute("SELECT set_config('statement_timeout', %s, true)", (STATEMENT_TIMEOUT,))
        return conn.execute(sql, params).fetchall()

    try:
        data = srv.db._do(_exec)
    except Exception as e:
        print(f"[METRICS] query failed: {e}")
        data = []

    data_rows = [[r[a] for a in aliases] for r in (data or [])]
    return _synth(cols_meta, data_rows)


# ─── Introspection for the builder UI ─────────────────────────────────

def describe_datasets():
    """Full catalog for the catalog-driven builder."""
    out = []
    for key, ds in DATASETS.items():
        out.append({
            "key": key,
            "label": ds.label or key,
            "provider": ds.provider is not None,
            "dimensions": [{"key": k, "label": d.label or k, "type": d.type}
                           for k, d in ds.dimensions.items()],
            "measures": [{"key": k, "label": m.label or k, "type": m.type}
                         for k, m in ds.measures.items()],
            "filters": [{"key": k, "type": f.type, "ops": list(f.ops)}
                        for k, f in ds.filters.items()],
        })
    return out


def list_presets():
    """[{key, name, spec}] for the preset picker."""
    return [{"key": k, "name": v["name"], "spec": v["spec"]}
            for k, v in METRIC_PRESETS.items()]


def resolve_spec(db_info):
    """Return the effective spec for a computed note_database row, or None.

    Prefers a stored metric_spec; falls back to a named preset (metric_key).
    """
    spec = db_info.get("metric_spec")
    if spec:
        return spec
    preset = METRIC_PRESETS.get(db_info.get("metric_key"))
    return preset["spec"] if preset else None
