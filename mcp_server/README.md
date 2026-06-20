# Mycelium MCP server

Lets Claude (Claude Desktop / Claude Code) **read notes, create & append blocks,
build live-metric dashboards, and analyze them** in Mycelium.

It's a thin authenticated client over Mycelium's existing REST API — it has **no
privileges of its own**. It acts as a real account, so all permissions and the
admin-only gating on metrics apply exactly as in the web app. No backend changes.

## Install

```bash
pip install -r mcp_server/requirements.txt
```

## Authenticate

Pick one (env vars):

- **JWT (recommended)** — `MYCELIUM_JWT`: open Mycelium in your browser, log in,
  copy the `JWT` cookie value (DevTools → Application → Cookies). Lasts ~100 days.
- **Credentials** — `MYCELIUM_EMAIL` + `MYCELIUM_PASSWORD`: the server logs in for you.

Also set `MYCELIUM_URL` (default `http://localhost:808`), e.g.
`https://mycelium.carbonlab.dev`.

> Live-metric tools (`list_metric_datasets`, `run_metric`, `create_metric_block`)
> only work if the account is a **platform admin** (member of an op server) —
> same rule as the ⚡ builder in the app.

## Connect from Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mycelium": {
      "command": "python",
      "args": ["/absolute/path/to/disclone/mcp_server/server.py"],
      "env": {
        "MYCELIUM_URL": "https://mycelium.carbonlab.dev",
        "MYCELIUM_JWT": "<your-jwt-cookie>"
      }
    }
  }
}
```

(Claude Code: `claude mcp add mycelium -- python /abs/path/mcp_server/server.py`,
then set the same env vars.)

## Tools

| Tool | What it does |
|------|--------------|
| `list_servers` | Servers the account belongs to |
| `list_note_channels(server_id)` | Note channels in a server (+ op flag) |
| `read_note(channel_id)` | Note content as ordered blocks |
| `create_note_channel(server_id, name)` | New collaborative-note channel |
| `append_block(channel_id, content, type)` | Append a block (write analysis back) |
| `read_database(channel_id, block_uuid)` | A database / live metric as columns+rows |
| `list_metric_datasets()` | Live-metric catalog + presets *(admin)* |
| `run_metric(spec)` | Run a MetricSpec live, no save *(admin)* |
| `create_metric_block(channel_id, spec, name)` | Add a live-metric block to a note *(admin)* |

## Example prompts

- *"Read the 'Roadmap' note in server 4 and summarize the open items as a new block."*
- *"Run the messages-per-day metric for the last 30 days and tell me the trend."*
- *"Create a metrics note with signups (7d) and server health, then analyze them."*
