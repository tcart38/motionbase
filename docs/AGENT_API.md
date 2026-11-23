# MotionBase Agent API

A token-authenticated HTTP API that lets an AI agent (Claude, a script, anything that can send HTTP) triage a MotionBase library: look at what is waiting, view frames of each clip, then tag, file, annotate and mark items reviewed. Machine-readable description: [`openapi.json`](./openapi.json), also served at `GET /api/agent/v1/openapi.json`.

Base URL: `http://<host>:<port>/api/agent/v1`

## Safety model

- **Tokens.** Create one per agent in the UI (Settings > Agent API) or via `POST /api/tokens`. The `mb_...` token is shown **once**; only its SHA-256 hash is stored. Revoke with `DELETE /api/tokens/{id}`. Alternatively set the `AGENT_API_TOKEN` environment variable for a single static token (reported as agent `env`).
- **The rest of the MotionBase API is unauthenticated.** `/api/tokens`, `/api/activity` and the web UI API have no login, like the rest of the app, so anyone who can reach the port can mint tokens. Run MotionBase on a trusted network or behind a reverse proxy with authentication. Do not expose it to the internet as is.
- **Agents cannot touch system categories** (currently "Aspect Ratio"); such tags are preserved and any attempt to add/remove them is rejected.
- **Atomic bulk writes.** Up to 500 updates per request. Every item is validated first; if any fails, nothing is applied and the response is `422` with per-item errors. `dry_run: true` returns exactly what would change and writes nothing.
- **Undo.** Every write is recorded in the activity log with before/after snapshots. Revert from the UI or `POST /api/activity/{id}/revert`. Reverting restores the affected files to their earlier state (tags, notes, folder, favorite, review state); it overwrites later edits to those files.
- **Provenance.** Tags added through the API are stored with `source: "agent"` (UI tags are `"user"`, automatic aspect-ratio tags `"system"`), so the UI can show an AI badge and filter by it.
- **Confirmation mode.** The setting `agent_requires_confirmation` (default `false`; `PUT /api/settings {"agent_requires_confirmation": true}`) controls what `mark_reviewed` does. Off: the file is marked reviewed and leaves the Inbox. On: only `agent_reviewed_at` is stamped; the file has status `needs_review` and stays in the Inbox until a person confirms it.

## Conventions

- JSON in and out; send `Content-Type: application/json`.
- Auth: `Authorization: Bearer mb_...` on everything except `GET /` and `GET /openapi.json`.
- Errors: `{"error": "message"}` with a 4xx/5xx status. Validation failures of batch writes: `422 {"error": "...", "errors": [{"index": 0, "file_id": 12, "errors": ["..."]}]}`.
- Timestamps are UTC (`YYYY-MM-DD HH:MM:SS` from SQLite, ISO-8601 for leases).
- Pagination: `limit` (max 200) and an opaque-ish `cursor` (the `next_cursor` of the previous page; ordered by file id ascending). `next_cursor` is `null` on the last page.
- Review `status` values: `pending` (not touched by anyone), `needs_review` (agent-reviewed, awaiting human confirmation), `reviewed`. Filter-only extras: `untagged` (no non-system tags), `agent_reviewed` (any agent-reviewed file), `all`.
- Creation endpoints are idempotent: `created: false` when the thing already existed (names match case-insensitively).

```bash
export MB=http://localhost:3001/api/agent/v1
export TOKEN=mb_xxxxxxxx        # from Settings > Agent API
AUTH="Authorization: Bearer $TOKEN"
```

## Endpoints

### Discovery and state

```bash
curl $MB/                      # index (public)
curl $MB/openapi.json          # OpenAPI 3.1 (public)
curl -H "$AUTH" $MB/status     # counts per status, leased count, requires_confirmation, ffmpeg availability
curl -H "$AUTH" $MB/taxonomy   # categories (id, description, selection single|multi, is_system, tags[]) and folders (id, path, counts)
```

Always read `/taxonomy` first: category and tag **descriptions** tell the agent how the user wants things classified, and `selection: "single"` means at most one tag per file in that category.

### Listing files

```bash
curl -H "$AUTH" "$MB/files?status=pending&limit=50"
curl -H "$AUTH" "$MB/files?folder=Brands/Acme&subfolders=1&search=logo"
curl -H "$AUTH" "$MB/files?folder=none&status=untagged"         # unfiled
curl -H "$AUTH" "$MB/files?cursor=120&limit=50"
curl -H "$AUTH" $MB/files/42
```

Query: `status`, `folder` (id, path or `none`), `subfolders` (`1` default, `0` = that folder only), `tags` (comma-separated tag ids), `search` (filename or notes), `favorites=1`, `limit`, `cursor`. A file contains `tags` (with `source`), `tags_by_category`, `folder_path`, `notes`, `review` and `urls`.

### Looking at a clip

Requires `ffmpeg` on the server (the Docker image has it); responses are `503` otherwise. Frames are cached under `DATA_DIR/frames/<file id>/`.

```bash
curl -H "$AUTH" "$MB/files/42/frames?count=8&width=640"                 # timestamps + URLs (JSON)
curl -H "$AUTH" "$MB/files/42/frames/3.jpg?count=8&width=640" -o f3.jpg   # one frame
curl -H "$AUTH" "$MB/files/42/contact-sheet.jpg?count=9&cols=3" -o sheet.jpg
curl -H "$AUTH" "$MB/files/42/thumbnail.jpg" -o thumb.jpg
```

`count` is capped at 16, `width` at 1024. Frames are evenly spaced across the duration (middle of each slice). The contact sheet is a single JPEG whose longest side is at most 1568 px, tiles in reading order; the `X-Frame-Times` response header lists each tile's timestamp in seconds. Images return a single frame.

### Writing

All update objects accept any of:

| Field | Meaning |
|---|---|
| `add_tag_ids`, `remove_tag_ids`, `set_tag_ids` | By id. `set_tag_ids` replaces all non-system tags. |
| `add_tags`, `remove_tags` | `[{"category": "Brand", "name": "Acme"}]` |
| `set_category_tags` | `{"Video Type": ["Explainer"]}` replaces **only** that category (empty array clears it). |
| `notes`, `notes_mode` | `replace` (default) or `append` (adds a blank line then the text). `null` clears. |
| `folder_id` / `folder_path` | Move into a folder; `folder_id: null` unfiles. Not both. |
| `favorite` | boolean |
| `mark_reviewed` | See confirmation mode above; also releases the file's lease. |

Request-level flags: `create_missing` (create unknown categories, tags and folders instead of failing) and `dry_run`.

```bash
# one file
curl -H "$AUTH" -H 'Content-Type: application/json' -X PATCH $MB/files/42 -d '{
  "set_category_tags": {"Video Type": ["Explainer"], "Mood": ["Calm"]},
  "add_tags": [{"category": "Brand", "name": "Acme"}],
  "notes": "Clean isometric explainer; good easing on the title card.",
  "folder_path": "Brands/Acme", "mark_reviewed": true, "create_missing": true }'

# many files, different changes (validate all, then apply)
curl -H "$AUTH" -H 'Content-Type: application/json' -X POST $MB/files/bulk -d '{
  "dry_run": true, "create_missing": true,
  "updates": [
    {"file_id": 42, "set_category_tags": {"Video Type": ["Explainer"]}, "mark_reviewed": true},
    {"file_id": 43, "add_tags": [{"category": "Brand", "name": "Globex"}], "notes": "logo sting"}
  ] }'

# the same change to many files
curl -H "$AUTH" -H 'Content-Type: application/json' -X POST $MB/files/apply -d '{
  "file_ids": [42, 43, 44], "folder_path": "Inbox review", "mark_reviewed": true }'

# just mark reviewed
curl -H "$AUTH" -H 'Content-Type: application/json' -X POST $MB/files/review -d '{"file_ids": [42, 43]}'
```

A successful write returns `{dry_run, applied, unchanged, activity_id, created: {categories, tags, folders}, results: [{file_id, changed, tags_added, tags_removed, folder?, notes_changed?, ...}]}`. `activity_id` is what you undo with.

Create taxonomy explicitly (idempotent; `201` when created, `200` with `created: false` otherwise):

```bash
curl -H "$AUTH" -H 'Content-Type: application/json' -X POST $MB/categories -d '{"name":"Mood","description":"Overall emotional feel","selection":"single"}'
curl -H "$AUTH" -H 'Content-Type: application/json' -X POST $MB/tags -d '{"category":"Mood","name":"Calm","description":"Slow, soft motion"}'
curl -H "$AUTH" -H 'Content-Type: application/json' -X POST $MB/folders -d '{"path":"Brands/Acme"}'
```

### Work queue (parallel agents)

`POST /queue/claim` leases up to `limit` (default 10, max 100) files of the given `status` (default `pending`) for `lease_seconds` (default 900, 30-3600). Leased files are skipped by other claims until the lease expires, they are released, or the file is marked reviewed. Leases are advisory: they do not block writes. `owner` defaults to the token name; pass distinct owners for several workers sharing a token.

```bash
curl -H "$AUTH" -H 'Content-Type: application/json' -X POST $MB/queue/claim -d '{"limit": 10, "lease_seconds": 900}'
curl -H "$AUTH" -H 'Content-Type: application/json' -X POST $MB/queue/release -d '{"file_ids": [42]}'   # omit file_ids to release everything you hold
```

### Activity and undo

```bash
curl -H "$AUTH" "$MB/activity?limit=20"        # newest first; ?id=N returns before/after snapshots
curl -X POST http://localhost:3001/api/activity/17/revert    # UI endpoint, no token
```

Taxonomy creations appear in the log but cannot be reverted (delete the tag/category/folder in Settings instead).

## Suggested agent workflow prompt

Copy this into an agent's instructions (replace the base URL, keep the token in an environment variable or secret store, never in the prompt):

```
You triage a MotionBase media library through its Agent API.
Base URL: http://HOST:3001/api/agent/v1   Auth: Authorization: Bearer $MOTIONBASE_TOKEN
Full reference: GET /openapi.json.

Setup (once per run):
1. GET /status to see how many files are pending and whether ffmpeg is available.
2. GET /taxonomy. Read every category and tag description: they are the user's rules.
   Prefer existing tags. Only create a new tag when nothing fits, using POST /tags or
   create_missing, and give it a short description. Never invent near-duplicates.
   Categories with selection "single" take at most one tag per file.
   Categories with is_system true are read-only.

Loop until /queue/claim returns no files:
3. POST /queue/claim {"limit": 8, "lease_seconds": 900}.
4. For each file, GET /files/{id}/contact-sheet.jpg?count=9&cols=3 and look at it
   (use /frames/{i}.jpg?count=8 for detail on a specific moment). Use filename, duration,
   and existing tags/notes as extra context. Stills: the single frame is the contact sheet.
5. Decide, per file: category tags via set_category_tags, a one-to-two sentence factual note
   (what it shows, notable motion technique; no speculation), and a folder_path only if
   an existing folder clearly fits. If you are unsure about a file, do NOT mark it
   reviewed; add a short note explaining the doubt and leave it pending.
6. POST /files/bulk with all decisions for the batch, first with "dry_run": true,
   check the results, then repeat without dry_run. Include "mark_reviewed": true only for
   files you are confident about. If you get a 422, fix every listed error and resend.
7. POST /queue/release {} for anything you claimed but skipped.

Rules: never delete or rename anything (the API cannot). Be consistent across files.
If anything looks wrong afterwards, tell the user the activity_id so they can revert it.
When finished, report counts: reviewed, left pending (with reasons), tags created.
```
