# Changelog

All notable changes to MotionBase are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
