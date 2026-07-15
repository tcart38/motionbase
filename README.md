# MotionBase

A self-hosted library for motion and graphic design inspiration. MotionBase watches a folder of video/image files, auto-generates thumbnails and metadata, and gives you a fast UI to tag, filter, search, and preview everything in one place — instead of a folder of cryptically-named clips you never look at again.

## Features

- **Auto-scanning** — point it at a media folder and it indexes new files on a schedule (or on demand), extracting duration, resolution, fps, aspect ratio, and file size via `ffprobe`, and generating a thumbnail for each file.
- **Inbox workflow** — newly scanned files land in an Inbox view so you can tag/review them before they show up in the main Library.
- **Tagging with categories** — organize tags into categories (e.g. Brand, Video Type, 2D/3D) with an auto-managed "Aspect Ratio" category. Filtering is AND-across-categories, OR-within-category. Categories with many tags collapse to the most-used, with a searchable popover for the rest.
- **Bulk tagging** — select multiple files in the Library and apply/remove tags across all of them at once.
- **Search & filter** — filter by tag combination, favorites, or "No Tags" (untagged); search by filename; sort by date added, filename, or duration. Filters live in the URL, so they survive navigating into a file and back.
- **Library preview & playback** — hover a card to scrub through a clip, or play it in place in a modal without leaving the grid (with an "Open Page" jump to the full Player). The grid remembers your scroll position when you return.
- **Player view** — stream video with range-request seeking, frame-by-frame stepping, adjustable playback speed, and volume that persists across files. A resizable side panel toggles between Tags and Notes, and metadata is shown alongside. Sized to fit the screen without page scrolling.
- **Favorites & notes** — star files and jot down freeform notes on them.
- **URL import** — paste a video URL and MotionBase downloads it (via `yt-dlp`) straight into your media folder, then auto-scans it in.
- **File upload** — drag-and-drop files directly into the media folder from the browser.
- **Light/dark mode.**

## Tech stack

- **Backend**: Node.js + Express, SQLite (via `better-sqlite3`), `ffprobe`/`ffmpeg` for metadata & thumbnails, `yt-dlp` for URL imports.
- **Frontend**: React + Vite + Tailwind CSS.
- **Deployment**: single Docker image (multi-stage build bundles the frontend into the backend's static assets). Every push to `main` auto-builds and publishes the image to GitHub Container Registry as `ghcr.io/tcart38/motionbase:latest` via GitHub Actions (`.github/workflows/docker-publish.yml`).

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
| `NODE_ENV`      | —       | Set to `production` in the Docker image; enables serving the built frontend. |

### Data persistence

Everything MotionBase needs to keep is under `DATA_DIR`: the SQLite database (`motionbase.db`) and generated thumbnails. Mount that to a persistent location (Docker named volume or an Unraid appdata path) so tags/favorites/notes survive container recreation. `MEDIA_DIR` only needs to be readable — MotionBase reads your files but doesn't need to modify them (except when renaming a file from the UI, or writing new downloads/uploads into it).

### A note on `yt-dlp` cookies

If you use URL import against sites that require a login (e.g. to download something you have access to but is behind auth), MotionBase can use a `cookies.txt` file for `yt-dlp`. This file contains live session cookies — **never commit it to git** (it's already covered by `.gitignore` via `.data/`), and treat it the same as a password.
