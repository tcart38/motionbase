# Exporting your library

MotionBase can export your videos and everything it knows about them (tags, folders, notes, favorites, review state, optionally history), and restore that metadata later. Exports are **admin-only when login is on** and open when login is off. Every export and restore is recorded in the audit log (`export`, `metadata_import`).

Never exported: the database file, API tokens, password hashes, sessions, `cookies.txt`, thumbnails or anything outside the media files and metadata. Trashed files are excluded unless you ask for them (`include_trash=1`). Files that are marked missing (no longer on disk) are not exported.

## What you get

| File | Contents |
|---|---|
| `videos/<folder path>/<filename>` | Your files, in the same folder hierarchy as MotionBase's virtual folders (unfiled files sit in `videos/`). Name collisions become `name (2).ext`. Videos are stored without compression. |
| `metadata.csv` | One row per file, for spreadsheets. UTF-8 with BOM, CRLF line ends, RFC 4180 quoting. Text cells starting with `=`, `+`, `-` or `@` get a leading `'` so spreadsheets never run them as formulas. |
| `metadata.json` | Everything, in a restorable form (see below). |
| `README.txt` | What was exported, restore steps and any skipped files. |

### CSV columns

`id, filename, relative_path, folder_path, file_type, duration_seconds, width, height, fps, aspect_ratio, file_size_bytes, date_added, uploaded_by, upload_source, favorite, reviewed, reviewed_by, in_trash, notes, source_url, author, tags`, then one column per tag category (system categories such as Aspect Ratio are left out; a category whose name clashes with a fixed column is headed `<name> (tags)`).

- `relative_path` is the path relative to `MEDIA_DIR`; `folder_path` is the MotionBase folder (`A/B/C`).
- `favorite`, `reviewed`, `in_trash` are `1`/`0`.
- `group_title` / `group_position`: the media group of the clip (title, 0-based position) or empty. Restore re-creates a group from files that share a `group_title` and are not grouped yet (reported as `groups_created`).
- `source_url` and `author` are read from the `Source:` / `Author:` lines the URL import writes into notes.
- `tags` is every tag as `Category: Tag` joined by `; `; each category column holds that category's tags joined by `; `.

### JSON shape

```json
{
  "exported_at": "2026-11-23T10:00:00.000Z",
  "motionbase_version": "2.0.0",
  "include_trash": false, "include_history": false,
  "categories": [{ "name": "Brand", "description": null, "selection": "single", "is_system": false,
                   "tags": [{ "name": "Acme", "description": null }] }],
  "folders": ["Campaigns", "Campaigns/Spring"],
  "files": [{ "id": 1, "filename": "a.mp4", "relative_path": "sub/a.mp4", "folder_path": "Campaigns",
              "file_type": "video", "duration_seconds": 12.5, "width": 1920, "height": 1080, "fps": 30,
              "aspect_ratio": "16:9", "file_size_bytes": 123, "date_added": "...", "uploaded_by": "Ann",
              "upload_source": "upload", "favorite": true, "reviewed": true, "reviewed_by": "user",
              "reviewed_at": "...", "in_trash": false, "group_title": null, "group_position": null, "notes": "...", "source_url": null, "author": null,
              "tags": [{ "category": "Brand", "name": "Acme", "source": "user" }],
              "history": [{ "action": "tags_changed", "actor": "Ann", "created_at": "...", "detail": {} }] }]
}
```

`history` is present only with `include_history=1` (JSON only).

## Ways to export

All endpoints need an admin session when login is on.

### Size estimate

`GET /api/export/estimate?include_trash=0` returns `{files, bytes}` for a full export (the web UI shows it before you download).

### Metadata only (streamed)

`GET /api/export/metadata?format=csv|json&include_trash=0&include_history=0`

Pages through the database and streams the response, so even very large libraries use little memory.

### Full export as a streamed download

`GET /api/export/download.zip?include_trash=0&include_history=0`

Streams a zip (no compression for videos, ZIP64 automatically for large libraries). Nothing is staged on disk. If the browser disconnects the work stops. Files that are missing or unreadable are skipped and listed in `README.txt`. No `Content-Length` is sent (the size is not known up front), so browsers show no total.

### Server-side export jobs

For big libraries, let the server write the export to disk (`EXPORT_DIR`) and fetch it later or copy it yourself.

| Call | |
|---|---|
| `POST /api/export/jobs` body `{mode: "full"\|"metadata", layout: "zip"\|"folder", include_history, include_trash}` | `202` with the job. `507` (`{error, needed_bytes, free_bytes}`) when free space in `EXPORT_DIR` is below what the export needs. |
| `GET /api/export/jobs` | `{jobs: [...]}`, newest first |
| `GET /api/export/jobs/:id` | One job |
| `POST /api/export/jobs/:id/cancel` | Cancels a queued or running job and removes its partial output |
| `DELETE /api/export/jobs/:id` | Removes a finished/failed/cancelled job and its output (409 while queued/running) |
| `GET /api/export/jobs/:id/download` | Streams a finished zip (supports `Range`) |

Job object: `{id, state: queued|running|done|failed|cancelled, mode, layout, include_history, include_trash, created_at, started_at, finished_at, files_done, files_total, files_skipped, bytes_done, bytes_total, needed_bytes, output_bytes, path, download_url, error, created_by, skipped: [first 50]}`. `path` is the location on the server; `download_url` is set for finished zips. In `metadata` mode `bytes_total` is 0.

- `layout: "zip"` writes `motionbase-export-<timestamp>.zip`; `layout: "folder"` copies files into `motionbase-export-<timestamp>/` with the same structure as the zip (streamed copy, nothing is zipped).
- One job runs at a time, inside the server process; others wait as `queued`. Jobs are remembered in `EXPORT_DIR/.jobs/`, so finished exports stay listed after a restart. A job that was running when the server stopped is shown as `failed`.
- Before starting (and again when a queued job starts) the free space of `EXPORT_DIR` is checked against the size of the files plus metadata. The export is refused rather than filling the disk.

## Environment

| Variable | Default | |
|---|---|---|
| `EXPORT_DIR` | `$DATA_DIR/exports` | Where export jobs write. Must **not** be inside `MEDIA_DIR` (the scanner would import the copies); such requests are refused. Mount it on a volume with enough space if your library is large. |

## Restoring metadata

Metadata restore reads an exported `metadata.json`; it never reads or writes anything outside the library and does not need the videos to be in place beforehand except to match them.

1. Put your videos back in the media directory (copy `videos/...` back; keep the folder layout so paths match).
2. Run a scan (Settings, or wait for the automatic scan) so MotionBase knows the files.
3. Dry run: `POST /api/import/metadata?dry_run=1` with the contents of `metadata.json` as the JSON body. Nothing is written.
4. Run it for real: `POST /api/import/metadata` (add `overwrite_notes=1` to replace non-empty notes).

```
curl -b cookies.txt -H 'Content-Type: application/json' --data-binary @metadata.json \
  'http://localhost:3001/api/import/metadata?dry_run=1'
```

Files are matched by `relative_path` (relative to `MEDIA_DIR`), then by `filename` + `file_size_bytes` when that is unique. What is restored:

- categories and tags (created when missing, with their descriptions and single/multi mode); system tags (aspect ratio) are automatic and skipped
- folders, including empty ones, and the folder of each file that is currently unfiled (files already in a folder are left alone)
- notes, only when the file's notes are empty (unless `overwrite_notes=1`)
- favorites and reviewed state (only turned on, never off)

Response: `{dry_run, total, matched, matched_by_path, matched_by_name_size, unmatched: [first 50], unmatched_count, files_changed, categories_created, tags_created, tags_added, folders_created, folders_set, notes_set, notes_skipped, favorites_set, reviewed_set, errors: [first 20]}`. Running it twice changes nothing the second time. Real imports are written to each file's History (`metadata_imported`) and to the audit log, attributed to the signed-in user. The import is all-or-nothing (one transaction). History in the export is informational and is not re-imported.

## Limits

- The restore body can be up to 100 MB (other JSON routes allow 2 MB).
- Zip downloads need the files to stay readable while streaming; files that vanish are skipped and listed.
- Symlinks that resolve outside `MEDIA_DIR` are skipped (never exported).
- Two zip entries that differ only by letter case are treated as a collision and renamed.
- The streamed download can be slow to start for huge libraries (it first walks the database); use a job if a proxy times out.
