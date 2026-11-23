# Accounts, uploaders and file history

Login in MotionBase is **optional and off by default**. With it off, nothing changes: anyone who can reach the app has full access, exactly like before. Turn it on when more than one person uses the library and you want to know who added and changed what.

The [Agent API](AGENT_API.md) and [MCP](MCP.md) keep their own bearer-token authentication. They work the same whether login is on or off.

## Turning login on

1. Open the app and go to Settings > Accounts, then "Turn on login" (first run only: create the first administrator).
2. The first account is always an **admin**. Creating it turns login on and signs you in.
3. Add the other people under Settings > Accounts (admins only): a username, display name, role and an initial password they can change themselves.

Passwords need at least 10 characters. Sessions last 30 days and slide forward while you use the app.

To turn login off again, an admin uses Settings > Accounts > "Turn off login" and re-enters their password. Accounts, history and sessions are kept; sessions are ignored while login is off. To turn it back on an admin signs in again with their username and password.

Over the API:

| Call | Purpose |
|---|---|
| `GET /api/auth/status` | Public. `{enabled, setup_required, user, version}` |
| `GET /api/auth/directory` | Any signed-in user (or anyone while login is off). `{users:[{id, display_name, username}]}` for every account including disabled ones; used by the Library's "Uploaded by" filter |
| `POST /api/auth/setup` | First run, only while no users exist. Creates the admin, turns login on, signs in |
| `POST /api/auth/enable` | Login is off but accounts exist: an admin's `{username, password}` turns it on |
| `POST /api/auth/login`, `/logout` | Sign in or out |
| `POST /api/auth/password`, `PATCH /api/auth/me` | Change own password / display name |
| `POST /api/auth/disable` | Admin turns login off (`{password}`) |

## In the app

- **Settings > Accounts**: turn login on or off, change your display name and password, and (admins) manage users, reset passwords, read the audit log.
- **Sidebar footer**: your name and role, with Change password and Sign out.
- **Library**: each card shows who added the file ("Library scan", "Imported" or the person's name). Sort by Uploader, or use the "Uploaded by" filter (the URL keeps `uploader=<id>` or `uploader=none`). The filter lists everyone from `GET /api/auth/directory`, including disabled accounts.
- **Player > History**: a timeline of changes (newest first) ending with the upload entry. Agent changes show the token name with an AI badge.

## Roles

| | User | Admin |
|---|:-:|:-:|
| Browse, search, play, download | yes | yes |
| Upload, URL import, tag, notes, folders, favorites, review, rename | yes | yes |
| Move to Trash and restore | yes | yes |
| Own agent tokens (create, list, revoke) | yes | yes |
| See and revoke other users' tokens | no | yes |
| Delete forever (purge, empty Trash) | no | yes |
| Revert agent activity | no | yes |
| Settings changes (scan interval, agent confirmation), cookies upload | no | yes |
| Import folders from disk structure | no | yes |
| Manage users and reset passwords | no | yes |
| Audit log | no | yes |

Users are never deleted, only disabled, so history keeps their names. There is always at least one active admin: the last one cannot be disabled or demoted, and you cannot disable yourself.

## Uploader tracking

Every file records who added it (`uploader`) and how (`upload_source`):

- `user`: uploaded through the app.
- `import`: added by URL import.
- `scan`: found in the media folder by the scanner.
- empty: added before accounts existed. The uploader is unknown.

When login is off the uploader is also unknown (`null`). The Library can filter by uploader (`GET /api/files?uploader=<userId>|none`) and sort by uploader name (`sort=uploader`, unknown uploaders last).

## File history

Each file has a History: who tagged it, edited notes, moved it, favorited, reviewed, renamed, trashed, restored or reverted, and what the agent changed (shown as `<token name> (agent)`, attributed to the token's owner). `GET /api/files/{id}/history` returns it newest first, including a synthesized "added" entry for files that predate accounts. With login off, changes made in the UI have no named actor.

Permanent deletions are not part of a file's history (the file is gone). They are recorded in the admin audit log instead (`GET /api/admin/audit`), together with logins, failed logins, user changes, token creation and revocation, settings changes, and turning login on or off.

## Recovery: locked out

Run the recovery command against the same data folder as the server. In Docker:

```bash
docker exec -it motionbase node src/cli/reset-password.js <username> '<new password>'
docker exec -it motionbase node src/cli/reset-password.js --disable-login
```

The first form sets a new password (at least 10 characters), re-enables the account if it was disabled and signs that user out everywhere. `--disable-login` turns login off so you can get back in (it can be combined with a reset). Replace `motionbase` with your container name. Outside Docker, run `node src/cli/reset-password.js ...` in `backend/` with the same `DATA_DIR`.

## Security notes

- **Put MotionBase behind an HTTPS reverse proxy** before exposing it beyond your LAN. Session cookies are `HttpOnly` and `SameSite=Lax`, and get the `Secure` flag when the request is HTTPS or the proxy sends `X-Forwarded-Proto: https`.
- Passwords are hashed with scrypt and a per-user salt. Session tokens are random 32-byte values stored only as SHA-256 hashes. Tokens for the Agent API are stored hashed too.
- Failed logins are rate limited: 5 failures per username and client address in 15 minutes give `429` with `Retry-After`. Behind a reverse proxy set `TRUST_PROXY=1` so the real client address is used instead of the proxy's.
- Writes authenticated by a cookie must come from the same origin (`Origin` must match `Host`) and send JSON (uploads may be `multipart/form-data`).
- Agent tokens belong to the user who created them. If that user is disabled their tokens stop working until they are enabled again. Tokens created while login was off have no owner and are only visible to admins.
- Media streams and thumbnails also require a session while login is on.
- Everything stays in `DATA_DIR/motionbase.db`. Back it up as before. The upgrade to accounts is a normal additive migration (version 4) that backs the database up first.
