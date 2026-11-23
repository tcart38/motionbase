# Changelog

All notable changes to MotionBase are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Optional self sign-up (migration 5, off by default, only when login is on): admins enable "Allow sign-ups" and "Require admin approval" (on by default) under Settings > Accounts. The sign-in page then offers "Create account". Sign-ups are always normal users, rate limited (5 per hour per IP, 50 per day overall, `429` with `Retry-After`) and audited (`signup`, `signup_approved`, `signup_rejected`). Pending accounts cannot sign in or use agent tokens; admins approve or reject them in the Users table (pending badge and count on the tab). New `POST /api/auth/signup`, `POST /api/users/{id}/approve|reject`; `GET /api/auth/status` returns `signups_enabled` and `signups_require_approval`; `GET /api/users` returns `pending` per user and `pending_count`. See `docs/ACCOUNTS.md`.
- Settings > Data tab (admin-only when login is on): export metadata (CSV/JSON), download a full zip, run server-side export jobs with live progress, and restore metadata from `metadata.json` with a dry run first. New `GET /api/export/estimate`.
- `GET /api/auth/directory`: any signed-in user can list accounts (id, display name, username, including disabled ones) so the Library's "Uploaded by" filter is complete for everyone.
- Data export and metadata restore (backend; `docs/EXPORT.md`), admin-only when login is on: `GET /api/export/metadata` (CSV or JSON, streamed, formula-injection-safe), `GET /api/export/download.zip` (streamed full export: videos in your folder layout, `metadata.csv`, `metadata.json`, `README.txt`; ZIP64 and no recompression), server-side export jobs under `/api/export/jobs` (zip or plain folder, progress, cancel, disk-space check, resumable download) written to the new `EXPORT_DIR` (default `DATA_DIR/exports`), and `POST /api/import/metadata` to restore tags, categories, folders, notes, favorites and review state from `metadata.json` (dry run, matches by path then filename + size, audited). Trash is excluded unless `include_trash=1`. New dependency: `archiver`.
- Web UI for accounts: a sign-in page (with rate-limit countdown), a Settings > Accounts tab (turn login on with first-run admin setup or an existing admin, my account, users table, audit log, turn off login), a user menu in the sidebar (change password, sign out), and admin-only controls hidden or disabled for normal users (Settings General, Trash purge, agent-activity revert, folder import, confirmation switch). Agent API tokens show only your own for users and an Owner column for admins.
- Library: uploader avatar and name on each card, sort by Uploader, an "Uploaded by" filter (kept in the URL as `uploader=<id>|none`), uploader in the Player Info tab and Inbox. Player: a History tab with a timeline of who changed what and when (agent changes carry an AI badge), ending with the upload entry.
- Optional accounts (migration 4), off by default. First-run setup creates an admin and turns login on; admins add users (admin or user role), reset passwords and disable accounts. Scrypt-hashed passwords, hashed 30-day sliding sessions in an HttpOnly cookie, login rate limit, same-origin checks on cookie-authenticated writes, an admin audit log (`/api/admin/audit`) and a recovery command (`node src/cli/reset-password.js`, with `--disable-login`). The Agent API and MCP keep bearer-token auth and work with login on or off. Agent tokens now belong to the user who created them. Details in `docs/ACCOUNTS.md`.
- Uploader tracking: files record who added them and how (`uploader`, `upload_source`); the file list filters by `uploader` and sorts by `sort=uploader`; agent file objects include the uploader's name and accept an `uploader` filter.
- Per-file History: `GET /api/files/{id}/history` lists who tagged, annotated, moved, favorited, reviewed, renamed, trashed, restored or reverted a file, including agent changes (shown as `<token> (agent)`).
- New environment variable `TRUST_PROXY=1` to use the real client address behind a reverse proxy.
- Delete with Undo: videos move to a Trash (soft delete, migration 3) from the Library (card menu and bulk bar) and the Player (button or Del key), with an Undo toast. The Trash page restores or permanently deletes (which also removes the file from the media folder, with confirmation). Trashed files are hidden from the Library, folder counts and the agent API, and the scanner won't re-import them.
- URL import: source details (author, link, platform, post date when the site provides it, and the description/caption) are saved into the file's Notes on download, without overwriting existing notes. For LinkedIn posts, yt-dlp leaves the author and date empty (the page now uses `VideoObject.creator`, which its extractor ignores), so MotionBase reads them, plus the full caption, from the post page itself, falling back to parsing the page title.
- MCP for any AI tool: MotionBase serves MCP over streamable HTTP at `/mcp` (same bearer tokens), plus a local stdio server (`mcp/`, also in the image at `/app/mcp`). Native tools over the Agent API, including contact sheets and frames as images. Setup in `docs/MCP.md` and in the Settings > Agent API guide (Connect an AI tab).
- Settings > Agent API: an in-app guide with what the API can and cannot do, copy-paste curl quick start, endpoint list and a ready-made agent prompt.
- Player: Page Up / Page Down step one frame back / forward; a folder button above the side-panel tabs (Shift+M).

### Changed
- Settings writes, cookies upload, permanent delete (purge), agent-activity revert and import-from-disk-structure are admin-only when login is on.
- The scan timer no longer keeps the Node process alive by itself.
- Sidebar: explicit collapse/expand button replaces the draggable-looking edge rail.

## [2.0.0]

### Added
- Agent API at `/api/agent/v1` with hashed bearer tokens, frames and contact sheets, atomic dry-runnable bulk updates, queue leases and an activity log with revert. Documented in `docs/AGENT_API.md` with an OpenAPI spec.
- Virtual nested folders (database only), folder views in the Library, drag-and-drop onto folders, and optional import of the on-disk directory structure.
- Review tracking (`reviewed_at`, `reviewed_by`), tag provenance (user, agent, system) and an "AI-tagged / Needs review" workflow, with a setting to require your confirmation for agent changes.
- Tag category description and single/multiple selection mode; tag descriptions.
- Inbox triage page with a queue, preview, tags, folder and notes, keyboard shortcuts and undo.
- Add Media page (upload and URL import).
- Settings tabs: General, Appearance, Taxonomy, Folders, Agent API (tokens, confirmation switch, activity and revert).
- Command palette (Ctrl/Cmd+K), shortcuts dialog (`?`) and `g`-prefixed navigation chords.
- Versioned database migrations with an automatic backup before upgrading.
- Backend test suite (`npm test`).
- Cookies for URL import: the `/api/cookies` endpoint is now mounted, managed from Settings > General, and passed to `yt-dlp --cookies`.

### Changed
- Frontend rebuilt on React 19, Tailwind CSS v4 and shadcn/ui (Base UI, Remix icons); Library, Player and Settings redesigned, responsive down to 375px.
- Library uses infinite scrolling, shift-click range selection and undoable bulk actions.
- Theme can follow the system setting; animations respect "reduce motion".
- Confirmation prompts use AlertDialog.

### Removed
- The legacy Tailwind v3 styles and bridge classes, and the `lucide-react` dependency.

### Fixed
- Cookies route was never mounted, so uploaded cookies were ignored by URL import.

## [1.2.0]

Earlier releases (1.0.0 to 1.2.0): library, tagging, player, URL import and upload, GHCR image and Unraid install. See the git history.
