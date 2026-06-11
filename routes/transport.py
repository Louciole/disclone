"""Public transit endpoints (mobility API proxy).

Thin proxy over a configurable upstream mobility API (configured under the
``[MOBILITY]`` section of ``server.ini``). Endpoints expose operators, lines,
stops and live arrivals. All upstream-shaping logic lives in the module-level
``_mobility_*`` helpers below; they take ``self`` explicitly so they can read
``self.config`` and raise ``HTTPError`` via ``self.response``.
"""
import json
import datetime
import requests

from vesta import Server, HTTPError


def _mobility_config(self):
    api_base = self.config.get("MOBILITY", "API_BASE", fallback="").strip()
    api_key = self.config.get("MOBILITY", "API_KEY", fallback="").strip()
    api_key_mode = self.config.get("MOBILITY", "API_KEY_MODE", fallback="query").strip().lower()
    api_key_header = self.config.get("MOBILITY", "API_KEY_HEADER", fallback="apikey").strip()
    operators_raw = self.config.get("MOBILITY", "OPERATORS", fallback="{}").strip()
    try:
        operators = json.loads(operators_raw) if operators_raw else {}
    except json.JSONDecodeError:
        operators = {}
    return {
        "api_base": api_base.rstrip("/"),
        "api_key": api_key,
        "api_key_mode": api_key_mode,
        "api_key_header": api_key_header,
        "operators": operators if isinstance(operators, dict) else {}
    }


def _mobility_get_operator(self, operator):
    config = _mobility_config(self)
    op_cfg = config["operators"].get(operator)
    if not op_cfg:
        raise HTTPError(self.response, 404, "unknown operator")
    return config, op_cfg


def _mobility_build_params(self, params_template, replacements):
    params = {}
    if not isinstance(params_template, dict):
        return params
    for key, value in params_template.items():
        if isinstance(value, str):
            try:
                rendered = value.format(**replacements)
            except KeyError:
                rendered = value
            if rendered == "" or rendered == "None":
                continue
            params[key] = rendered
        else:
            params[key] = value
    return params


def _mobility_apply_key(self, params, headers, config):
    if not config.get("api_key"):
        return
    if config.get("api_key_mode") == "header":
        headers[config.get("api_key_header") or "apikey"] = config["api_key"]
    else:
        params["apikey"] = config["api_key"]


def _mobility_request_json(self, url, params, config):
    headers = {}
    params = params or {}
    if url.startswith("/"):
        if not config.get("api_base"):
            raise HTTPError(self.response, 400, "mobility api base missing")
        url = f"{config['api_base']}{url}"
    _mobility_apply_key(self, params, headers, config)
    response = requests.get(url, params=params, headers=headers, timeout=10)
    if response.status_code >= 400:
        raise HTTPError(self.response, response.status_code, "mobility upstream error")
    return response.json()


def _mobility_extract_items(self, payload, items_path):
    data = payload
    if items_path:
        for key in str(items_path).split("."):
            if isinstance(data, dict):
                data = data.get(key)
            else:
                data = None
            if data is None:
                break
    if isinstance(data, list):
        return data
    if isinstance(payload, list):
        return payload
    return []


def _mobility_extract_fields(self, item):
    if isinstance(item, dict):
        if "fields" in item:
            return item["fields"]
        if "record" in item and isinstance(item["record"], dict) and "fields" in item["record"]:
            return item["record"]["fields"]
    return item


def _mobility_get_field(self, data, field_path):
    if not field_path:
        return None
    current = data
    for key in str(field_path).split("."):
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            return None
    return current


def _mobility_minutes_from_time(self, value):
    if value is None:
        return None
    now = datetime.datetime.now(datetime.timezone.utc)
    if isinstance(value, (int, float)):
        if value > 1e12:
            dt = datetime.datetime.fromtimestamp(value / 1000.0, tz=datetime.timezone.utc)
        elif value > 1e9:
            dt = datetime.datetime.fromtimestamp(value, tz=datetime.timezone.utc)
        else:
            return int(max(value, 0))
    else:
        try:
            text = str(value).replace("Z", "+00:00")
            dt = datetime.datetime.fromisoformat(text)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
        except ValueError:
            return None
    minutes = int((dt - now).total_seconds() / 60)
    return max(minutes, 0)


@Server.expose
def transport_operators(self):
    self.getUser()
    config = _mobility_config(self)
    operators = []
    for op_id, op_cfg in config["operators"].items():
        label = op_cfg.get("label") if isinstance(op_cfg, dict) else None
        operators.append({"id": op_id, "label": label or op_id.upper()})
    return json.dumps({"operators": operators})


@Server.expose
def transport_lines(self, operator):
    self.getUser()
    config, op_cfg = _mobility_get_operator(self, operator)
    lines_cfg = op_cfg.get("lines") if isinstance(op_cfg, dict) else None
    if not lines_cfg or not lines_cfg.get("url"):
        raise HTTPError(self.response, 400, "lines not configured")

    params = _mobility_build_params(self, lines_cfg.get("params"), {"operator": operator})
    payload = _mobility_request_json(self, lines_cfg["url"], params, config)
    items = _mobility_extract_items(self, payload, lines_cfg.get("items_path"))

    id_field = lines_cfg.get("id_field", "id")
    label_field = lines_cfg.get("label_field", "name")
    lines = []
    for item in items:
        fields = _mobility_extract_fields(self, item)
        line_id = _mobility_get_field(self, fields, id_field)
        if line_id is None:
            continue
        label = _mobility_get_field(self, fields, label_field)
        lines.append({"id": line_id, "label": label or line_id})

    return json.dumps({"lines": lines}, default=str)


@Server.expose
def transport_stops(self, operator, line=None):
    self.getUser()
    config, op_cfg = _mobility_get_operator(self, operator)
    stops_cfg = op_cfg.get("stops") if isinstance(op_cfg, dict) else None
    if not stops_cfg or not stops_cfg.get("url"):
        raise HTTPError(self.response, 400, "stops not configured")

    params = _mobility_build_params(self, stops_cfg.get("params"), {"operator": operator, "line": line or ""})
    payload = _mobility_request_json(self, stops_cfg["url"], params, config)
    items = _mobility_extract_items(self, payload, stops_cfg.get("items_path"))

    id_field = stops_cfg.get("id_field", "id")
    label_field = stops_cfg.get("label_field", "name")
    stops = []
    for item in items:
        fields = _mobility_extract_fields(self, item)
        stop_id = _mobility_get_field(self, fields, id_field)
        if stop_id is None:
            continue
        label = _mobility_get_field(self, fields, label_field)
        stops.append({"id": stop_id, "label": label or stop_id})

    return json.dumps({"stops": stops}, default=str)


@Server.expose
def transport_arrivals(self, operator, stop=None, line=None):
    self.getUser()
    config, op_cfg = _mobility_get_operator(self, operator)
    arrivals_cfg = op_cfg.get("arrivals") if isinstance(op_cfg, dict) else None
    if not arrivals_cfg or not arrivals_cfg.get("url"):
        raise HTTPError(self.response, 400, "arrivals not configured")
    if not stop:
        raise HTTPError(self.response, 400, "stop required")

    params = _mobility_build_params(
        self,
        arrivals_cfg.get("params"),
        {"operator": operator, "line": line or "", "stop": stop}
    )
    payload = _mobility_request_json(self, arrivals_cfg["url"], params, config)
    items = _mobility_extract_items(self, payload, arrivals_cfg.get("items_path"))

    time_field = arrivals_cfg.get("time_field", "arrival_time")
    destination_field = arrivals_cfg.get("destination_field", "destination")
    line_field = arrivals_cfg.get("line_field", "line")

    arrivals = []
    for item in items:
        fields = _mobility_extract_fields(self, item)
        arrival_time = _mobility_get_field(self, fields, time_field)
        minutes = _mobility_minutes_from_time(self, arrival_time)
        arrivals.append({
            "arrival_time": arrival_time,
            "minutes": minutes,
            "destination": _mobility_get_field(self, fields, destination_field),
            "line": _mobility_get_field(self, fields, line_field)
        })

    arrivals.sort(key=lambda entry: entry.get("minutes") if entry.get("minutes") is not None else 999999)
    timestamp = datetime.datetime.now().strftime("%H:%M")
    return json.dumps({"arrivals": arrivals, "timestamp": timestamp}, default=str)
