# MotionBase MCP server

`mcp/` is a small [Model Context Protocol](https://modelcontextprotocol.io) server (stdio) that wraps the [Agent API](./AGENT_API.md), so Claude gets native tools instead of hand-written curl calls, and sees video frames as images.

## Tools

| Tool | What it does |
|---|---|
| `motionbase_status` | Counts of pending / needs-review / reviewed videos |
| `motionbase_taxonomy` | Categories (with descriptions, single/multi), tags, folders. Read first |
| `motionbase_list_files`, `motionbase_get_file` | Browse and inspect videos |
| `motionbase_view_contact_sheet` | One image of evenly spaced frames + timestamps |
| `motionbase_view_frame` | One full frame, for a closer look |
| `motionbase_claim_files`, `motionbase_release_files` | Lease batches so parallel agents don't overlap |
| `motionbase_update_files` | Tag / note / file / mark reviewed, up to 500 at once, all-or-nothing, `dry_run` |
| `motionbase_create` | Create a category, tag or folder (idempotent) |
| `motionbase_recent_activity` | What agents changed (revert in MotionBase) |

It has the same limits as the HTTP API: it cannot delete or rename anything.

## Setup

1. In MotionBase: Settings > Agent API > create a token (`mb_...`).
2. Pick one:

**Clone the repo** (Node 20+): `cd mcp && npm install`, then

```bash
claude mcp add motionbase \
  --env MOTIONBASE_URL=http://HOST:3001 \
  --env MOTIONBASE_TOKEN=mb_xxxxxxxx \
  -- node /path/to/motionbase/mcp/index.js
```

Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "motionbase": {
  "command": "node", "args": ["/path/to/motionbase/mcp/index.js"],
  "env": { "MOTIONBASE_URL": "http://HOST:3001", "MOTIONBASE_TOKEN": "mb_xxxxxxxx" } } } }
```

**No clone, via Docker** (the MCP server ships in the image at `/app/mcp`; inside the container the URL is `http://localhost:3001`, so only the token is needed):

```bash
claude mcp add motionbase -- docker exec -i -e MOTIONBASE_TOKEN=mb_xxxxxxxx motionbase node /app/mcp/index.js
# MotionBase on another machine:
claude mcp add motionbase -- ssh user@vm-host docker exec -i -e MOTIONBASE_TOKEN=mb_xxxxxxxx motionbase node /app/mcp/index.js
```

3. Restart Claude and ask: "Triage my MotionBase inbox: read the taxonomy, then work through pending videos in batches of 8, dry-running each batch first."

Environment: `MOTIONBASE_URL` (default `http://localhost:3001`) and `MOTIONBASE_TOKEN` (required). Tests: `cd mcp && npm test`.
