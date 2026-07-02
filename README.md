# MotionBase

A self-hosted library for motion and graphic design inspiration. MotionBase watches a folder of video/image files, auto-generates thumbnails and metadata, and gives you a fast UI to tag, filter, search, and preview everything in one place — instead of a folder of cryptically-named clips you never look at again.

## Features

- **Auto-scanning** — point it at a media folder and it indexes new files on a schedule (or on demand), extracting duration, resolution, fps, and aspect ratio via `ffprobe`, and generating a thumbnail for each file.
- **Inbox workflow** — newly scanned files land in an Inbox view so you can tag/review them before they show up in the main Library.
- **Tagging with categories** — organize tags into categories (e.g. Brand, Video Type, 2D/3D) with an auto-managed "Aspect Ratio" category. Filtering is AND-across-categories, OR-within-category.
- **Favorites & notes** — star files and jot down freeform notes on them.
- **Search & filter** — filter by tag combination, favorites, or filename search; sort by date added, filename, or duration.
- **In-browser preview** — stream video with range-request seeking directly in the Player view, no download required.
- **URL import** — paste a video URL and MotionBase downloads it (via `yt-dlp`) straight into your media folder, then auto-scans it in.
- **File upload** — drag-and-drop files directly into the media folder from the browser.
- **Light/dark mode.**

## Tech stack

- **Backend**: Node.js + Express, SQLite (via `better-sqlite3`), `ffprobe`/`ffmpeg` for metadata & thumbnails, `yt-dlp` for URL imports.
- **Frontend**: React + Vite + Tailwind CSS.
- **Deployment**: single Docker image (multi-stage build bundles the frontend into the backend's static assets).

## Running locally (development)

Requires Node.js 20+, and `ffmpeg` installed and on your `PATH` (for thumbnails/metadata). `python3` + `yt-dlp` are only needed if you want URL import to work locally.

```bash
# Backend
cd backend
cp .env.example .env   # edit MEDIA_DIR / DATA_DIR to local paths
npm install
npm run dev             # runs on http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm install
npm run dev              # runs on http://localhost:5173, proxies /api to :3001
```

Set `MEDIA_DIR` in `backend/.env` to a folder of video/image files you want indexed, and `DATA_DIR` to a writable folder for the SQLite database and generated thumbnails.

> Note: `better-sqlite3` and Vite's `rollup` dependency ship native binaries. If you copy `node_modules` between machines (e.g. different OS/architecture), delete `node_modules` and run `npm install` fresh on the target machine.

## Running with Docker (local test)

```bash
docker compose up --build
```

This builds the frontend, bundles it into the backend image, and serves everything from a single container on `http://localhost:3001`. By default `docker-compose.yml` mounts `./test-media` as the media folder — point it at a real folder before relying on it.

## Installing on Unraid

MotionBase ships as a normal Docker image, so it runs on Unraid via the built-in Docker manager — no Community Applications template needed, just add a container manually (or via `docker-compose` if you run the Compose Manager plugin).

**Option A — Compose Manager plugin (easiest if installed):**

1. Copy this repo onto your Unraid box (e.g. `/mnt/user/appdata/motionbase` or wherever you keep source checkouts), or just copy `docker-compose.yml` and `Dockerfile` there along with `backend/` and `frontend/`.
2. Edit `docker-compose.yml`:
   - Change the `./test-media` mount to the real path of your inspo folder, e.g. `/mnt/user/Media/Inspo:/media:ro`.
   - Optionally point the `motionbase-data` volume at an appdata path instead of a named Docker volume, e.g. `/mnt/user/appdata/motionbase:/data`.
3. In the Compose Manager tab, add this project and bring it up.

**Option B — Manual Docker container via the Unraid UI:**

1. Build the image once (on Unraid or elsewhere, then push/load it), or let Unraid build it from the Dockerfile if your setup supports build-from-source.
2. Add a new container with:
   - **Repository**: your built image tag (e.g. `motionbase:latest`)
   - **Port**: `3001` → container `3001`
   - **Path**: your inspo folder → `/media` (read-only is fine, MotionBase doesn't need write access there)
   - **Path**: an appdata folder (e.g. `/mnt/user/appdata/motionbase`) → `/data` (read/write — this holds the SQLite DB and thumbnails)
   - **Environment**: see variables below
3. Apply, then visit `http://<your-unraid-ip>:3001`.

Once running, MotionBase will do an initial scan of `/media` and keep rescanning on the interval configured in Settings (or `SCAN_INTERVAL`).

### Environment variables

| Variable        | Default | Description                                                        |
|-----------------|---------|----------------------------------------------------------------------|
| `PORT`          | `3001`  | Port the server listens on.                                          |
| `MEDIA_DIR`     | `/media`| Folder to scan for video/image files. Mount your inspo folder here.  |
| `DATA_DIR`      | `/data` | Writable folder for the SQLite DB and generated thumbnails. Should be a persistent volume/appdata path. |
| `SCAN_INTERVAL` | `30`    | Minutes between automatic rescans (also editable in-app under Settings). `0` disables auto-scan. |
| `NODE_ENV`      | —       | Set to `production` in the Docker image; enables serving the built frontend. |

### Data persistence

Everything MotionBase needs to keep is under `DATA_DIR`: the SQLite database (`motionbase.db`) and generated thumbnails. Mount that to a persistent location (Docker named volume or an Unraid appdata path) so tags/favorites/notes survive container recreation. `MEDIA_DIR` only needs to be readable — MotionBase reads your files but doesn't need to modify them (except when renaming a file from the UI, or writing new downloads/uploads into it).

### A note on `yt-dlp` cookies

If you use URL import against sites that require a login (e.g. to download something you have access to but is behind auth), MotionBase can use a `cookies.txt` file for `yt-dlp`. This file contains live session cookies — **never commit it to git** (it's already covered by `.gitignore` via `.data/`), and treat it the same as a password.
