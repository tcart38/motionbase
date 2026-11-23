// Per-file history (file_events). Events are recorded by the central mutation path so the UI
// routes, the agent API, bulk actions and activity revert all show up.

// An "actor" is { user_id, token_id, label }. label is null when nobody could be identified
// (UI change with login off).
export const NO_ACTOR = Object.freeze({ user_id: null, token_id: null, label: null })

export function actorFromReq(req) {
  const u = req?.user
  return u ? { user_id: u.id, token_id: null, label: u.display_name } : NO_ACTOR
}

// agent: { tokenId, name, userId } as set by agentAuth
export function actorFromAgent(agent) {
  return { user_id: agent?.userId ?? null, token_id: agent?.tokenId ?? null, label: `${agent?.name || 'unknown'} (agent)` }
}

export function recordEvent(db, fileId, by, action, detail = null) {
  const a = by || NO_ACTOR
  db.prepare(`
    INSERT INTO file_events (file_id, user_id, token_id, actor_label, action, detail_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(fileId, a.user_id ?? null, a.token_id ?? null, a.label ?? null, action, detail ? JSON.stringify(detail) : null)
}

export const truncate = (s, n = 500) => (s == null ? s : String(s).length > n ? String(s).slice(0, n) : String(s))

// Tag ids -> [{category, name}]
export function describeTags(db, ids) {
  if (!ids.length) return []
  return db.prepare(`
    SELECT c.name AS category, t.name FROM tags t JOIN tag_categories c ON c.id = t.category_id
    WHERE t.id IN (${ids.map(() => '?').join(',')}) ORDER BY c.name, t.name
  `).all(...ids)
}

export function getHistory(db, fileId, { limit = 200 } = {}) {
  const file = db.prepare(`
    SELECT f.id, f.date_added, f.uploaded_by, f.upload_source, u.username, u.display_name
    FROM files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.id = ?
  `).get(fileId)
  if (!file) return null
  const lim = Math.min(1000, Math.max(1, parseInt(limit, 10) || 200))
  const rows = db.prepare('SELECT * FROM file_events WHERE file_id = ? ORDER BY id DESC LIMIT ?').all(fileId, lim)
  const events = rows.map((r) => ({
    id: r.id, action: r.action,
    actor: { user_id: r.user_id, label: r.actor_label },
    detail: r.detail_json ? JSON.parse(r.detail_json) : null,
    created_at: r.created_at,
  }))
  const by = file.uploaded_by ? { id: file.uploaded_by, display_name: file.display_name, username: file.username } : null
  // Files that predate accounts (or whose upload was never logged) get a synthesized entry.
  if (rows.length < lim && !db.prepare("SELECT 1 FROM file_events WHERE file_id = ? AND action = 'uploaded'").get(fileId)) {
    events.push({
      id: null, action: 'uploaded', synthetic: true,
      actor: { user_id: file.uploaded_by, label: by?.display_name ?? null },
      detail: { source: file.upload_source },
      created_at: file.date_added,
    })
  }
  return { events, uploaded: { at: file.date_added, by, source: file.upload_source } }
}
