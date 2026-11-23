# MotionBase

A self-hosted library for motion and graphic design inspiration. MotionBase watches a folder of video/image files, auto-generates thumbnails and metadata, and gives you a fast UI to tag, filter, search, and preview everything in one place — instead of a folder of cryptically-named clips you never look at again.

## Features

- **Auto-scanning**: point it at a media folder and it indexes new files on a schedule (or on demand), extracting duration, resolution, fps, aspect ratio and file size via `ffprobe`, and generating a thumbnail for each file.
- **Inbox triage**: new files land in the Inbox, where you work through a queue with a large preview, tags, folder and notes, driven by the keyboard (`j`/`k` to move, `e` to confirm, `1`-`9` to toggle tags, `z` to undo). Files an agent has already tagged show up under "Needs review" for you to confirm.
- **Library**: a fast, infinite-scrolling grid with a filter bar and filter chips (tags, favorites, untagged, AI-tagged, folder), search over filenames and notes, sorting, multi-select with Shift-click ranges, and bulk actions (tag, move, favorite, mark reviewed, delete) that all come with an Undo toast. Deleting moves videos to a **Trash** (restore, or delete forever from there); nothing leaves the disk until you purge. Hover a card to scrub it, or play it in place.
- **Tags with categories**: organise tags into categories (Brand, Video Type, 2D/3D, ...). Each category has a description (shown to agents) and a selection mode, single or multiple tags. Filtering is AND across categories, OR within one. An "Aspect Ratio" category is maintained automatically.
- **Virtual folders**: nested folders that live only in the database; your media directory is never rearranged. Manage them from the sidebar (drag media onto a folder) or Settings > Folders, and optionally mirror the on-disk layout with "Import from disk structure".
- **Player**: range-request streaming with keyboard control (space, `m`, `f`, `,`/`.` or PgUp/PgDn frame step, `[`/`]` speed, Shift+M folder), a resizable side panel with Tags, Notes (autosaved) and Info tabs, favorites and download.
- **Add media**: drag-and-drop upload, or paste a video URL and MotionBase downloads it with `yt-dlp` (optionally using a `cookies.txt` you paste in Settings) and scans it in.
- **Agent API**: let an AI agent (or script) triage the Inbox: view frames and contact sheets, apply tags, notes and folders in atomic, dry-runnable batches, with an undoable activity log. Manage tokens, the "require my confirmation" switch and the activity log under Settings > Agent API. See [docs/AGENT_API.md](docs/AGENT_API.md). Any MCP-capable AI tool (Claude, Cursor, VS Code, Gemini CLI, ...) can connect natively: MotionBase serves **MCP at `/mcp`** (just a URL and your token), with a local stdio option too ([docs/MCP.md](docs/MCP.md)).
- **Optional accounts**: off by default. Turn on login to give each person their own account (admin and user roles), see who uploaded each file, filter and sort by uploader, and read a per-file History of who changed what (agent changes are attributed to the token and its owner). See [docs/ACCOUNTS.md](docs/ACCOUNTS.md).
- **Command palette and shortcuts**: `Ctrl/Cmd+K` jumps to pages, folders, tags and files and runs actions; `?` lists every shortcut; `g l`, `g i`, `g a`, `g s` go to Library, Inbox, Add Media and Settings.
- **Light, dark or system theme**, keyboard-accessible UI, responsive down to phone widths.

## Tech stack

- **Backend**: Node.js 20+ and Express, SQLite via `better-sqlite3` with versioned migrations (`PRAGMA user_version`, automatic pre-upgrade backup), `ffprobe`/`ffmpeg` for metadata, thumbnails and agent frames, `yt-dlp` for URL imports. Tests use `node:test`.
- **Frontend**: React 19, Vite 5 and Tailwind CSS v4. UI built on [shadcn/ui](https://ui.shadcn.com) (Base UI primitives, preset `b7CSfRACu`, Remix icons, Inter font), TanStack Query for data fetching, react-router 6, sonner toasts and cmdk for the command palette. Plain JavaScript (no TypeScript). See `frontend/DESIGN_NOTES.md`.
- **Deployment**: single Docker image (multi-stage build bundles the frontend into the backend's static assets). Every push to `main` auto-builds and publishes the image to GitHub Container Registry as `ghcr.io/tcart38/motionbase:latest` via GitHub Actions (`.github/workflows/docker-publish.yml`).

## Running locally (development)

Requires Node.js 20+ (22 recommended) and `ffmpeg` on your `PATH` (thumbnails, metadata, agent frames). `python3` + `yt-dlp` are only needed for URL import. The repo uses npm.

```bash
# Backend
cd backend
cp .env.example .env   # edit MEDIA_DIR / DATA_DIR to local paths
npm install
npm run dev             # runs on http://localhost:3001
npm test                # backend tests

# Frontend (separate terminal)
cd frontend
npm install
npm run dev              # runs on http://localhost:5173, proxies /api and /thumbnails to :3001
npm run build            # production bundle in frontend/dist
```

The frontend path alias `@` maps to `frontend/src`. Add shadcn components with `npx shadcn@latest add <name>` from `frontend/` (it reads `components.json`).

Set `MEDIA_DIR` in `backend/.env` to a folder of video/image files you want indexed, and `DATA_DIR` to a writable folder for the SQLite database and generated thumbnails.

> Note: `better-sqlite3` and Vite's `rollup` dependency ship native binaries. If you copy `node_modules` between machines (e.g. different OS/architecture), delete `node_modules` and run `npm install` fresh on the target machine.

## Running with Docker (local test)

```bash
docker compose up --build
```

This builds the frontend, bundles it into the backend image, and serves everything from a single container on `http://localhost:3001`. By default `docker-compose.yml` mounts `./test-media` as the media folder — point it at a real folder before relying on it.

## Installing on Unraid

The recommended way is to pull the prebuilt image from GHCR using Unraid's built-in Docker manager — no Community Applications template or building from source needed. (You do **not** need docker-compose on Unraid; Compose only orchestrates multiple containers, and MotionBase is a single container. The Unraid Docker UI covers everything the compose file does.)

1. Docker tab → **Add Container**, then set:
   - **Repository**: `ghcr.io/tcart38/motionbase:latest`
   - **Network Type**: `Bridge`
   - **Port**: host port of your choice (e.g. `3006`) → container `3001`
   - **Path**: your inspo folder (e.g. `/mnt/user/swipe`) → container `/media` (read-only is fine — MotionBase reads your files but writes new downloads/uploads/renames here if you use those)
   - **Path**: an appdata folder (e.g. `/mnt/user/appdata/motionbase`) → container `/data` (read/write — holds the SQLite DB and thumbnails)
   - **Environment**: see variables below (all optional; the defaults match the container)
2. Apply, then visit `http://<your-unraid-ip>:<host-port>`.

On first launch MotionBase scans `/media`, then keeps rescanning on the interval configured in Settings (or `SCAN_INTERVAL`).

### Updating

Pushes to `main` trigger the GitHub Actions build, which republishes `ghcr.io/tcart38/motionbase:latest`. To pull the new build on Unraid: Docker tab → click the **MotionBase** icon → **Force Update** (or enable auto-update via the CA Auto Update Applications plugin). Your DB, thumbnails, tags, favorites, and notes are untouched because they live in the `/data` appdata mount.

The current app version is shown in the app under **Settings**, sourced from `backend/package.json`.

### Environment variables

| Variable        | Default | Description                                                        |
|-----------------|---------|----------------------------------------------------------------------|
| `PORT`          | `3001`  | Port the server listens on.                                          |
| `MEDIA_DIR`     | `/media`| Folder to scan for video/image files. Mount your inspo folder here.  |
| `DATA_DIR`      | `/data` | Writable folder for the SQLite DB and generated thumbnails. Should be a persistent volume/appdata path. |
| `SCAN_INTERVAL` | `30`    | Minutes between automatic rescans (also editable in-app under Settings). `0` disables auto-scan. |
| `AGENT_API_TOKEN` | —     | Optional static bearer token for the [Agent API](docs/AGENT_API.md), in addition to tokens created in Settings. |
| `TRUST_PROXY`   | —       | Set to `1` behind a reverse proxy so the login rate limit uses the real client address (`X-Forwarded-For`). |
| `FRAME_CONCURRENCY` | `2`   | Max simultaneous `ffmpeg` processes for agent frame/contact-sheet extraction. |
| `NODE_ENV`      | —       | Set to `production` in the Docker image; enables serving the built frontend. |

### Data persistence

Everything MotionBase needs to keep is under `DATA_DIR`: the SQLite database (`motionbase.db`), generated thumbnails (`thumbnails/`) and cached agent frames (`frames/`, safe to delete). Database schema upgrades run automatically on startup (tracked by `PRAGMA user_version`, additive only); before applying an upgrade to an existing database a consistent copy is written next to it as `motionbase.db.pre-vN-<timestamp>.bak`. Mount that to a persistent location (Docker named volume or an Unraid appdata path) so tags/favorites/notes survive container recreation. `MEDIA_DIR` only needs to be readable — MotionBase reads your files but doesn't need to modify them (except when renaming a file from the UI, or writing new downloads/uploads into it).

### A note on `yt-dlp` cookies

If you use URL import against sites that require a login (e.g. to download something you have access to but is behind auth), MotionBase can use a `cookies.txt` file for `yt-dlp`: paste it under Settings > General and it is saved as `DATA_DIR/cookies.txt` and passed to `yt-dlp --cookies` on every import (remove it there too). This file contains live session cookies — **never commit it to git** (it's already covered by `.gitignore` via `.data/`), and treat it the same as a password.

## Agent API

MotionBase exposes a token-authenticated API at `/api/agent/v1` for AI agents. Create a token under Settings > Agent API (shown once, stored hashed), then:

```bash
curl -H "Authorization: Bearer mb_..." http://localhost:3001/api/agent/v1/status
```

Highlights: list and filter files by review status, fetch evenly spaced frames or a contact sheet (needs `ffmpeg`), batch-update tags/notes/folders with `dry_run` and all-or-nothing validation, claim work with leases, and undo any agent change from the activity log. Agents never modify system categories. Full reference, curl examples and a copy-paste agent prompt: [docs/AGENT_API.md](docs/AGENT_API.md); OpenAPI spec: [docs/openapi.json](docs/openapi.json) (regenerate with `npm run openapi` in `backend/`).

> **Security:** login is off by default, and then the web UI's own API (including `/api/tokens`) has no authentication. Only expose MotionBase on a trusted network, or turn on accounts ([docs/ACCOUNTS.md](docs/ACCOUNTS.md)) and put it behind an HTTPS reverse proxy. If you are locked out, `docker exec -it <container> node src/cli/reset-password.js --disable-login` turns login off again.

## Tests

```bash
cd backend
npm test        # node:test; frame/contact-sheet tests are skipped when ffmpeg is not installed
```
