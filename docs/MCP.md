# MotionBase MCP server

MotionBase speaks [MCP (Model Context Protocol)](https://modelcontextprotocol.io), so any MCP-capable AI tool or agent (Claude, Cursor, VS Code / Copilot, Windsurf, Gemini CLI, Codex, and others) gets native tools instead of hand-written HTTP calls, and sees video frames as images. It wraps the [Agent API](./AGENT_API.md) and has the same limits: it cannot delete or rename anything.

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

## Two ways to connect

| | **URL (remote, streamable HTTP)** — recommended | **Local program (stdio)** |
|---|---|---|
| Where it runs | Inside MotionBase, at `http://HOST:PORT/mcp` | On the computer running your AI tool (the tool launches it) |
| Install | Nothing | Node 20+ and the `mcp/` folder (or run the copy in the Docker image over `docker exec` / SSH) |
| Auth | `Authorization: Bearer mb_...` header | `MOTIONBASE_TOKEN` environment variable |
| Works from | Any machine that can reach the server | The machine that runs the program (it calls MotionBase over HTTP) |
| Supported by | Remote-capable clients (Claude Code, Cursor, VS Code, Windsurf, Gemini CLI, ...) | Every MCP client, including local-only ones |

Both use the same tools and the same tokens (Settings > Agent API > create a token, shown once).

### URL (recommended)

Generic config for clients that support remote MCP servers with headers (key and file names vary slightly by tool, e.g. `~/.cursor/mcp.json`, `.vscode/mcp.json`):

```json
{ "mcpServers": { "motionbase": {
  "url": "http://HOST:3001/mcp",
  "headers": { "Authorization": "Bearer mb_xxxxxxxx" } } } }
```

Claude Code:

```bash
claude mcp add --transport http motionbase http://HOST:3001/mcp --header "Authorization: Bearer mb_xxxxxxxx"
```

Clients that only launch local servers (e.g. Claude Desktop) can use the `mcp-remote` bridge (Node required):

```json
{ "mcpServers": { "motionbase": {
  "command": "npx",
  "args": ["-y", "mcp-remote", "http://HOST:3001/mcp", "--allow-http", "--header", "Authorization: Bearer mb_xxxxxxxx"] } } }
```

Web-based AI apps (ChatGPT, claude.ai) need a public HTTPS address. MotionBase has no login of its own beyond the agent tokens, so only expose it that way behind a reverse proxy you trust.

The endpoint is stateless (`POST /mcp`; `GET` and `DELETE` return 405). Each tool call is made with the caller's own token, so the activity log shows which token did what.

### Local program (stdio)

Clone the repo, `cd mcp && npm install`, then point your client at it:

```json
{ "mcpServers": { "motionbase": {
  "command": "node", "args": ["/path/to/motionbase/mcp/index.js"],
  "env": { "MOTIONBASE_URL": "http://HOST:3001", "MOTIONBASE_TOKEN": "mb_xxxxxxxx" } } } }
```

No clone: the same server ships in the Docker image at `/app/mcp`. Inside the container the URL is `http://localhost:3001`, so only the token is needed. Use as the client's stdio `command`:

```bash
docker exec -i -e MOTIONBASE_TOKEN=mb_xxxxxxxx motionbase node /app/mcp/index.js
ssh user@vm-host docker exec -i -e MOTIONBASE_TOKEN=mb_xxxxxxxx motionbase node /app/mcp/index.js   # MotionBase on another machine
```

Environment: `MOTIONBASE_URL` (default `http://localhost:3001`) and `MOTIONBASE_TOKEN` (required). Tests: `cd mcp && npm test`.

## Try it

Ask your AI tool: "Triage my MotionBase inbox: read the taxonomy, then work through pending videos in batches of 8, dry-running each batch first."
