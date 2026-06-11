"""Notes blocks, spreadsheets and databases.

Endpoints take the live Mycelium instance as ``self``; shared helpers remain on
the class (see server.py).
"""
import json
import re

from vesta import Server, HTTPError


@Server.expose
def save_block(self, channel, block, op="edit"):
    uid = self.getUser()

    chan_info = self.db.getSomething("notes_channel", channel)
    if not chan_info:
        raise HTTPError(self.response, 404)

    self.require_server_perm(uid, chan_info["server"], "edit")

    block = json.loads(block)
    if op == "create":
        block["channel"] = channel
        block_id = self.db.insertDict("note_block", block, getId=True)

        # Auto-create note_database for database-type blocks
        if block.get("type") == "database" and block.get("uuid"):
            existing = self.db.getSomething("note_database", block["uuid"], "block_uuid")
            if not existing:
                db_id = self.db.insertDict("note_database", {
                    "block_uuid": block["uuid"],
                    "channel": channel,
                    "name": "Untitled Database",
                    "view_type": "table"
                }, getId=True)
                self.db.insertDict("note_database_column", {
                    "database_id": db_id,
                    "name": "Name",
                    "type": "text",
                    "position": 0.1
                })
                self.db.insertDict("note_database_row", {
                    "database_id": db_id,
                    "position": 0.1
                })
        if block.get("type") == "spreadsheet" and block.get("uuid"):
            existing = self.db.getSomething("note_spreadsheet", block["uuid"], "block_uuid")
            if not existing:
                self.db.insertDict("note_spreadsheet", {
                    "block_uuid": block["uuid"],
                    "channel": channel,
                    "rows": 3,
                    "cols": 2
                })

        return str(block_id)
    elif op == "delete":
        block_info = self.db.getSomething("note_block", str(block["uuid"]), "uuid")
        if not block_info or int(block_info["channel"]) != int(channel):
            raise HTTPError(self.response, 404)
        self.db.deleteSomething("note_block", block_info["id"])
    elif op == "edit":
        block_info = self.db.getSomething("note_block", str(block["uuid"]), "uuid")

        if not block_info or int(block_info["channel"]) != int(channel):
            raise HTTPError(self.response, 404)

        forbidden_fields = ["id", "channel", "uuid"]

        for key in block:
            if key not in forbidden_fields and block[key] != block_info.get(key):
                self.db.edit("note_block", block["uuid"], key, block[key], "uuid")

        # Auto-create note_database when block type changes to "database"
        if block.get("type") == "database" and block_info.get("type") != "database":
            existing = self.db.getSomething("note_database", block["uuid"], "block_uuid")
            if not existing:
                db_id = self.db.insertDict("note_database", {
                    "block_uuid": block["uuid"],
                    "channel": channel,
                    "name": "Untitled Database",
                    "view_type": "table"
                }, getId=True)
                self.db.insertDict("note_database_column", {
                    "database_id": db_id,
                    "name": "Name",
                    "type": "text",
                    "position": 0.1
                })
                self.db.insertDict("note_database_row", {
                    "database_id": db_id,
                    "position": 0.1
                })
        # Auto-create note_spreadsheet when block type changes to "spreadsheet"
        if block.get("type") == "spreadsheet" and block_info.get("type") != "spreadsheet":
            existing = self.db.getSomething("note_spreadsheet", block["uuid"], "block_uuid")
            if not existing:
                self.db.insertDict("note_spreadsheet", {
                    "block_uuid": block["uuid"],
                    "channel": channel,
                    "rows": 3,
                    "cols": 2
                })


@Server.expose
def get_database_content(self, channel, block_uuid):
    uid = self.getUser()
    self.require_channel_access(uid, channel, "note", "view")

    db_info = self.db.getSomething("note_database", block_uuid, "block_uuid")
    if not db_info:
        raise HTTPError(self.response, 404)

    db_id = db_info["id"]
    columns = self.db.getFilters("note_database_column", ["database_id", "=", db_id, "order by position"]) or []
    rows = self.db.getFilters("note_database_row", ["database_id", "=", db_id, "order by position"]) or []

    cells = {}
    for row in rows:
        row_cells = self.db.getFilters("note_database_cell", ["row_id", "=", row["id"]]) or []
        cells[str(row["id"])] = {str(c["column_id"]): c["value"] for c in row_cells}

    result = {
        "id": db_id,
        "block_uuid": db_info["block_uuid"],
        "name": db_info["name"],
        "view_type": db_info.get("view_type", "table"),
        "gallery_cover_column": db_info.get("gallery_cover_column"),
        "columns": columns,
        "rows": rows,
        "cells": cells
    }
    return json.dumps(result, default=str)


@Server.expose
def get_spreadsheet_content(self, block_uuid, channel=None, conv_id=None):
    uid = self.getUser()
    if conv_id is not None:
        _checkConvAccess(self, uid, conv_id)
    elif channel is not None:
        self.require_channel_access(uid, channel, "note", "view")
    else:
        raise HTTPError(self.response, 400)

    sheet_info = self.db.getSomething("note_spreadsheet", block_uuid, "block_uuid")
    if not sheet_info:
        raise HTTPError(self.response, 404)
    if conv_id is not None and str(sheet_info.get("conv_id")) != str(conv_id):
        raise HTTPError(self.response, 404)

    sheet_id = sheet_info["id"]
    cells_data = self.db.getFilters("note_spreadsheet_cell", ["spreadsheet_id", "=", sheet_id]) or []
    cells = {self._sheet_ref(c["col_idx"], c["row_idx"]): c["value"] for c in cells_data}
    col_widths = self._get_sheet_col_widths(sheet_id)

    result = {
        "id": sheet_id,
        "block_uuid": sheet_info["block_uuid"],
        "rows": sheet_info["rows"],
        "cols": sheet_info["cols"],
        "cells": cells,
        "col_widths": col_widths,
    }
    return json.dumps(result, default=str)


@Server.expose
def get_spreadsheet_snapshot(self, channel, block_uuid):
    uid = self.getUser()
    self.require_channel_access(uid, channel, "note", "view")

    sheet_info = self.db.getSomething("note_spreadsheet", block_uuid, "block_uuid")
    if not sheet_info or int(sheet_info["channel"]) != int(channel):
        raise HTTPError(self.response, 404)

    cells_data = self.db.getFilters("note_spreadsheet_cell", ["spreadsheet_id", "=", sheet_info["id"]]) or []
    cells = {self._sheet_ref(c["col_idx"], c["row_idx"]): c["value"] for c in cells_data}

    return json.dumps({
        "id": sheet_info["id"],
        "block_uuid": sheet_info["block_uuid"],
        "rows": sheet_info["rows"],
        "cols": sheet_info["cols"],
        "cells": cells,
    }, default=str)


@Server.expose
def save_spreadsheet_cell(self, spreadsheet_id, cell_id, value, channel=None, conv_id=None):
    uid = self.getUser()
    sheet_info = _get_sheet_info(self, uid, spreadsheet_id, channel=channel, conv_id=conv_id)

    if value is None:
        value = ""
    elif isinstance(value, str) and value.strip() == "":
        value = ""

    parsed = _parse_sheet_ref(self, cell_id)
    if not parsed:
        raise HTTPError(self.response, 400)

    row_idx = parsed["row"]
    col_idx = parsed["col"]
    if row_idx < 1 or row_idx > int(sheet_info["rows"]) or col_idx < 0 or col_idx >= int(sheet_info["cols"]):
        raise HTTPError(self.response, 400)

    existing = self.db.getFilters(
        "note_spreadsheet_cell",
        ["spreadsheet_id", "=", spreadsheet_id, "and", "row_idx", "=", row_idx, "and", "col_idx", "=", col_idx]
    )
    if existing:
        if value == "":
            self.db.deleteSomething("note_spreadsheet_cell", existing[0]["id"])
        else:
            self.db.edit("note_spreadsheet_cell", existing[0]["id"], "value", value)
    else:
        if value != "":
            self.db.insertDict("note_spreadsheet_cell", {
                "spreadsheet_id": spreadsheet_id,
                "row_idx": row_idx,
                "col_idx": col_idx,
                "value": value
            })


@Server.expose
def save_spreadsheet(self, spreadsheet_id, data, channel=None, conv_id=None):
    uid = self.getUser()

    try:
        data = json.loads(data)
    except Exception:
        raise HTTPError(self.response, 400)

    if not isinstance(data, dict):
        raise HTTPError(self.response, 400)

    sheet_info = _get_sheet_info(self, uid, spreadsheet_id, channel=channel, conv_id=conv_id)

    limits = {
        "rows": (1, 500),
        "cols": (1, 200),
    }

    for key, (min_val, max_val) in limits.items():
        if key not in data:
            continue

        try:
            value = int(data[key])
        except Exception:
            raise HTTPError(self.response, 400)

        if value < min_val or value > max_val:
            raise HTTPError(self.response, 400)

        if value != int(sheet_info.get(key)):
            self.db.edit("note_spreadsheet", spreadsheet_id, key, value)


@Server.expose
def save_spreadsheet_col_width(self, spreadsheet_id, col_idx, width, channel=None, conv_id=None):
    uid = self.getUser()
    sheet_info = _get_sheet_info(self, uid, spreadsheet_id, channel=channel, conv_id=conv_id)

    col_idx = int(col_idx)
    width = int(width)
    if col_idx < 0 or col_idx >= int(sheet_info["cols"]):
        raise HTTPError(self.response, 400)
    if width < 40 or width > 1200:
        raise HTTPError(self.response, 400)

    existing = self.db.getFilters(
        "note_spreadsheet_col",
        ["spreadsheet_id", "=", spreadsheet_id, "and", "col_idx", "=", col_idx]
    )
    if existing:
        self.db.edit("note_spreadsheet_col", existing[0]["id"], "width_px", width)
    else:
        self.db.insertDict("note_spreadsheet_col", {
            "spreadsheet_id": spreadsheet_id,
            "col_idx": col_idx,
            "width_px": width,
        })
    return json.dumps({"ok": True})


@Server.expose
def save_spreadsheet_structure(self, spreadsheet_id, op, ref, channel=None, conv_id=None):
    uid = self.getUser()
    sheet_info = _get_sheet_info(self, uid, spreadsheet_id, channel=channel, conv_id=conv_id)

    parsed = _parse_sheet_ref(self, ref)
    if not parsed:
        raise HTTPError(self.response, 400)

    rows = int(sheet_info["rows"])
    cols = int(sheet_info["cols"])
    if parsed["row"] < 1 or parsed["row"] > rows or parsed["col"] < 0 or parsed["col"] >= cols:
        raise HTTPError(self.response, 400)

    insert_col = None
    insert_row = None
    delete_col = None
    delete_row = None

    if op == "add-col-left":
        insert_col = parsed["col"]
        cols += 1
    elif op == "add-col-right":
        insert_col = parsed["col"] + 1
        cols += 1
    elif op == "add-row-top":
        insert_row = parsed["row"]
        rows += 1
    elif op == "add-row-bottom":
        insert_row = parsed["row"] + 1
        rows += 1
    elif op == "delete-col":
        if cols <= 1:
            raise HTTPError(self.response, 400)
        delete_col = parsed["col"]
        cols -= 1
    elif op == "delete-row":
        if rows <= 1:
            raise HTTPError(self.response, 400)
        delete_row = parsed["row"]
        rows -= 1
    else:
        raise HTTPError(self.response, 400)

    existing = self.db.getFilters("note_spreadsheet_cell", ["spreadsheet_id", "=", spreadsheet_id]) or []
    shifted = []
    col_width_rows = self.db.getFilters("note_spreadsheet_col", ["spreadsheet_id", "=", spreadsheet_id]) or []

    for cell in existing:
        c = int(cell.get("col_idx"))
        r = int(cell.get("row_idx"))

        if insert_col is not None and c >= insert_col:
            c += 1
        if insert_row is not None and r >= insert_row:
            r += 1

        if delete_col is not None:
            if c == delete_col:
                continue
            if c > delete_col:
                c -= 1

        if delete_row is not None:
            if r == delete_row:
                continue
            if r > delete_row:
                r -= 1

        shifted.append({"col_idx": c, "row_idx": r, "value": cell.get("value", "")})

    # Rewrite cells to avoid UNIQUE collisions while shifting coordinates.
    for cell in existing:
        self.db.deleteSomething("note_spreadsheet_cell", cell["id"])

    for cell in shifted:
        value = cell.get("value", "")
        if value == "":
            continue
        self.db.insertDict("note_spreadsheet_cell", {
            "spreadsheet_id": spreadsheet_id,
            "row_idx": cell["row_idx"],
            "col_idx": cell["col_idx"],
            "value": value
        })

    # Shift persisted column widths on column insert/delete.
    if insert_col is not None or delete_col is not None:
        width_map = {}
        for row in col_width_rows:
            idx = int(row["col_idx"])
            width_map[idx] = int(row["width_px"])

        shifted_widths = {}
        for idx, width in width_map.items():
            next_idx = idx
            if insert_col is not None and next_idx >= insert_col:
                next_idx += 1
            if delete_col is not None:
                if next_idx == delete_col:
                    continue
                if next_idx > delete_col:
                    next_idx -= 1
            if 0 <= next_idx < cols:
                shifted_widths[next_idx] = width

        if insert_col is not None and 0 <= insert_col < cols and insert_col not in shifted_widths:
            fallback = width_map.get(insert_col, width_map.get(insert_col - 1, 120))
            shifted_widths[insert_col] = fallback

        for row in col_width_rows:
            self.db.deleteSomething("note_spreadsheet_col", row["id"])

        for idx, width in shifted_widths.items():
            self.db.insertDict("note_spreadsheet_col", {
                "spreadsheet_id": spreadsheet_id,
                "col_idx": idx,
                "width_px": width,
            })

    self.db.edit("note_spreadsheet", spreadsheet_id, "rows", rows)
    self.db.edit("note_spreadsheet", spreadsheet_id, "cols", cols)
    return json.dumps({"rows": rows, "cols": cols, "col_widths": self._get_sheet_col_widths(spreadsheet_id)})


@Server.expose
def save_database(self, channel, database, op="create"):
    uid = self.getUser()
    _checkDatabaseAccess(self, uid, channel)
    database = json.loads(database)

    if op == "create":
        block_uuid = database.get("block_uuid")
        if not block_uuid:
            raise HTTPError(self.response, 400)
        # Idempotent: if database already exists for this block, return existing
        existing = self.db.getSomething("note_database", block_uuid, "block_uuid")
        if existing:
            return str(existing["id"])
        db_id = self.db.insertDict("note_database", {
            "block_uuid": block_uuid,
            "channel": channel,
            "name": database.get("name", "Untitled Database"),
            "view_type": database.get("view_type", "table")
        }, getId=True)
        # Create a default first column
        self.db.insertDict("note_database_column", {
            "database_id": db_id,
            "name": "Name",
            "type": "text",
            "position": 0.1
        })
        # Create a default first row
        self.db.insertDict("note_database_row", {
            "database_id": db_id,
            "position": 0.1
        })
        return str(db_id)
    elif op == "edit":
        db_info = self.db.getSomething("note_database", database["id"])
        if not db_info or int(db_info["channel"]) != int(channel):
            raise HTTPError(self.response, 404)
        allowed = ["name", "view_type", "gallery_cover_column"]
        for key in allowed:
            if key in database and database[key] != db_info.get(key):
                self.db.edit("note_database", database["id"], key, database[key])
    elif op == "delete":
        db_info = self.db.getSomething("note_database", database["id"])
        if not db_info or int(db_info["channel"]) != int(channel):
            raise HTTPError(self.response, 404)
        self.db.deleteSomething("note_database", database["id"])


@Server.expose
def save_database_column(self, channel, database_id, column, op="create"):
    uid = self.getUser()
    _checkDatabaseAccess(self, uid, channel)
    column = json.loads(column)

    db_info = self.db.getSomething("note_database", database_id)
    if not db_info or int(db_info["channel"]) != int(channel):
        raise HTTPError(self.response, 404)

    valid_types = ["text", "number", "checkbox", "date", "select", "relation", "formula"]

    if op == "create":
        col_type = column.get("type", "text")
        if col_type not in valid_types:
            raise HTTPError(self.response, 400)
        col_id = self.db.insertDict("note_database_column", {
            "database_id": database_id,
            "name": column.get("name", "Column"),
            "type": col_type,
            "position": column.get("position", 0.1),
            "options": json.dumps(column.get("options", {}))
        }, getId=True)
        return str(col_id)
    elif op == "edit":
        col_info = self.db.getSomething("note_database_column", column["id"])
        if not col_info or int(col_info["database_id"]) != int(database_id):
            raise HTTPError(self.response, 404)
        allowed = ["name", "type", "position", "options"]
        for key in allowed:
            if key in column:
                val = column[key]
                if key == "type" and val not in valid_types:
                    raise HTTPError(self.response, 400)
                if key == "options":
                    val = json.dumps(val)
                if str(val) != str(col_info.get(key)):
                    self.db.edit("note_database_column", column["id"], key, val)
    elif op == "delete":
        col_info = self.db.getSomething("note_database_column", column["id"])
        if not col_info or int(col_info["database_id"]) != int(database_id):
            raise HTTPError(self.response, 404)
        self.db.deleteSomething("note_database_column", column["id"])


@Server.expose
def save_database_row(self, channel, database_id, row, op="create"):
    uid = self.getUser()
    _checkDatabaseAccess(self, uid, channel)
    row = json.loads(row)

    db_info = self.db.getSomething("note_database", database_id)
    if not db_info or int(db_info["channel"]) != int(channel):
        raise HTTPError(self.response, 404)

    if op == "create":
        row_id = self.db.insertDict("note_database_row", {
            "database_id": database_id,
            "position": row.get("position", 0.1)
        }, getId=True)
        return str(row_id)
    elif op == "edit":
        row_info = self.db.getSomething("note_database_row", row["id"])
        if not row_info or int(row_info["database_id"]) != int(database_id):
            raise HTTPError(self.response, 404)
        if "position" in row:
            self.db.edit("note_database_row", row["id"], "position", row["position"])
    elif op == "delete":
        row_info = self.db.getSomething("note_database_row", row["id"])
        if not row_info or int(row_info["database_id"]) != int(database_id):
            raise HTTPError(self.response, 404)
        self.db.deleteSomething("note_database_row", row["id"])


@Server.expose
def save_database_cell(self, channel, database_id, cell):
    uid = self.getUser()
    _checkDatabaseAccess(self, uid, channel)
    cell = json.loads(cell)

    db_info = self.db.getSomething("note_database", database_id)
    if not db_info or int(db_info["channel"]) != int(channel):
        raise HTTPError(self.response, 404)

    row_id = cell["row_id"]
    column_id = cell["column_id"]
    value = cell.get("value", "")

    # Validate row belongs to this database
    row_info = self.db.getSomething("note_database_row", row_id)
    if not row_info or int(row_info["database_id"]) != int(database_id):
        raise HTTPError(self.response, 404)

    # Validate column belongs to this database
    col_info = self.db.getSomething("note_database_column", column_id)
    if not col_info or int(col_info["database_id"]) != int(database_id):
        raise HTTPError(self.response, 404)

    # For relation columns, validate target row exists
    if col_info["type"] == "relation":
        options = col_info.get("options", {})
        if isinstance(options, str):
            options = json.loads(options)
        target_db_id = options.get("database_id")
        if target_db_id and value:
            target_row = self.db.getSomething("note_database_row", value)
            if not target_row or int(target_row["database_id"]) != int(target_db_id):
                raise HTTPError(self.response, 400)

    # Upsert: try update, then insert
    existing = self.db.getFilters("note_database_cell", ["row_id", "=", row_id, "and", "column_id", "=", column_id])
    if existing:
        self.db.edit("note_database_cell", existing[0]["id"], "value", value)
    else:
        self.db.insertDict("note_database_cell", {
            "row_id": row_id,
            "column_id": column_id,
            "value": value
        })
    return json.dumps({"status": "ok"})


@Server.expose
def get_relation_display(self, database_id, row_id):
    """Get the display name (first text column value) for a row in a database."""
    uid = self.getUser()
    db_info = self.db.getSomething("note_database", database_id)
    if not db_info:
        raise HTTPError(self.response, 404)

    self.require_channel_access(uid, db_info["channel"], "note", "view")

    # Find first text column
    columns = self.db.getFilters("note_database_column", ["database_id", "=", database_id, "order by position"]) or []
    text_col = None
    for col in columns:
        if col["type"] == "text":
            text_col = col
            break

    if not text_col:
        return json.dumps({"display": "Row " + str(row_id)})

    cell = self.db.getFilters("note_database_cell", ["row_id", "=", row_id, "and", "column_id", "=", text_col["id"]]) or []
    display = cell[0]["value"] if cell else ""
    return json.dumps({"display": display or "Untitled"}, default=str)


def _checkDatabaseAccess(self, uid, channel):
    """Check that user has edit access to a notes channel. Returns server_id or raises."""
    chan_info = self.db.getSomething("notes_channel", channel)
    if not chan_info:
        raise HTTPError(self.response, 404)
    server_id = chan_info["server"]
    self.require_server_perm(uid, server_id, "edit")
    if chan_info.get("is_private") and not self.checkChannelAccess(uid, channel, "note", "view"):
        raise HTTPError(self.response, 403)
    return server_id


def _checkConvAccess(self, uid, conv_id):
    """Check that user can access the place (DM conv or textual channel). Returns conv_id as int or raises."""
    cid = int(conv_id)
    # DM / group conversation
    access = self.db.getFilters(
        "accessconversation",
        ["conversation", "=", cid, "and", "account", "=", uid]
    )
    if access:
        return cid
    # Server textual channel — any member of the server with view permission
    if self.checkChannelAccess(uid, cid, "textual", "view"):
        return cid
    raise HTTPError(self.response, 403)


def _get_sheet_info(self, uid, spreadsheet_id, channel=None, conv_id=None):
    """Auth-check and load note_spreadsheet row by ID. Raises on bad access or ownership mismatch."""
    if conv_id is not None:
        _checkConvAccess(self, uid, conv_id)
        sheet_info = self.db.getSomething("note_spreadsheet", spreadsheet_id)
        if not sheet_info or str(sheet_info.get("conv_id")) != str(conv_id):
            raise HTTPError(self.response, 404)
    elif channel is not None:
        _checkDatabaseAccess(self, uid, channel)
        sheet_info = self.db.getSomething("note_spreadsheet", spreadsheet_id)
        if not sheet_info or int(sheet_info.get("channel", -1)) != int(channel):
            raise HTTPError(self.response, 404)
    else:
        raise HTTPError(self.response, 400)
    return sheet_info


def _parse_sheet_ref(self, cell_id):
    m = re.match(r"^([A-Z]+)(\d+)$", str(cell_id or ""))
    if not m:
        return None

    letters = m.group(1)
    row_num = int(m.group(2))
    if row_num < 1:
        return None
    col_idx = 0
    for ch in letters:
        col_idx = col_idx * 26 + (ord(ch) - 64)
    return {"col": col_idx - 1, "row": row_num}

