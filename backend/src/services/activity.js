import { HttpError } from './errors.js'
import { getPathMap } from './folders.js'

// Everything an agent write can change on a file; used for undo.
export function snapshotFile(db, fileId, pathMap = getPathMap(db)) {
  const f = db.prepare(`
    SELECT id, notes, folder_id, is_favorite, needs_tagging, reviewed_at, reviewed_by, agent_reviewed_at
    FROM files WHERE id = ?
  `).get(fileId)
  if (!f) return null
  const tags = db.prepare(`
    SELECT t.id, t.name, c.name AS category, ft.source
    FROM file_tags ft JOIN tags t ON t.id = ft.tag_id JOIN tag_categories c ON c.id = t.category_id
    WHERE ft.file_id = ? ORDER BY c.name, t.name
  `).all(fileId)
  return { ...f, folder_path: f.folder_id ? pathMap.get(f.folder_id) ?? null : null, tags }
}

export function logActivity(db, { agent, action, fileIds = [], before = null, after = null }) {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO agent_activity (token_id, agent_name, action, file_ids, before_json, after_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    agent?.tokenId ?? null, agent?.name ?? null, action, JSON.stringify(fileIds),
    before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null
  )
  return Number(lastInsertRowid)
}

function summarize(row) {
  const file_ids = JSON.parse(row.file_ids)
  return {
    id: row.id, token_id: row.token_id, agent_name: row.agent_name, action: row.action,
    file_ids, file_count: file_ids.length, created_at: row.created_at, reverted_at: row.reverted_at,
    revertable: !!row.before_json && !row.reverted_at,
  }
}

// Newest first; cursor = id of the last row of the previous page.
export function listActivity(db, { limit = 50, cursor } = {}) {
  const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50))
  const rows = db.prepare(`
    SELECT * FROM agent_activity ${cursor ? 'WHERE id < ?' : ''} ORDER BY id DESC LIMIT ?
  `).all(...(cursor ? [Number(cursor)] : []), lim + 1)
  const page = rows.slice(0, lim)
  return {
    activity: page.map(summarize),
    next_cursor: rows.length > lim ? page.at(-1).id : null,
  }
}

export function getActivity(db, id) {
  const row = db.prepare('SELECT * FROM agent_activity WHERE id = ?').get(id)
  if (!row) return null
  return {
    ...summarize(row),
    before: row.before_json ? JSON.parse(row.before_json) : null,
    after: row.after_json ? JSON.parse(row.after_json) : null,
  }
}

// Restore every file in the entry to its pre-change snapshot. Later edits to the same
// files (by anyone) are overwritten.
export function revertActivity(db, id) {
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM agent_activity WHERE id = ?').get(id)
    if (!row) throw new HttpError(404, 'Not found')
    if (!row.before_json) throw new HttpError(422, 'This activity entry cannot be reverted')
    if (row.reverted_at) throw new HttpError(409, 'Already reverted')

    const before = JSON.parse(row.before_json)
    const tagExists = db.prepare('SELECT 1 FROM tags WHERE id = ?')
    let restored = 0
    for (const [fileId, snap] of Object.entries(before)) {
      if (!snap || !db.prepare('SELECT 1 FROM files WHERE id = ?').get(fileId)) continue
      const folderId = snap.folder_id && db.prepare('SELECT 1 FROM folders WHERE id = ?').get(snap.folder_id)
        ? snap.folder_id : null
      db.prepare(`
        UPDATE files SET notes = ?, folder_id = ?, is_favorite = ?, needs_tagging = ?,
          reviewed_at = ?, reviewed_by = ?, agent_reviewed_at = ? WHERE id = ?
      `).run(snap.notes, folderId, snap.is_favorite, snap.needs_tagging,
        snap.reviewed_at, snap.reviewed_by, snap.agent_reviewed_at, fileId)
      db.prepare('DELETE FROM file_tags WHERE file_id = ?').run(fileId)
      const ins = db.prepare('INSERT OR IGNORE INTO file_tags (file_id, tag_id, source) VALUES (?, ?, ?)')
      for (const t of snap.tags) if (tagExists.get(t.id)) ins.run(fileId, t.id, t.source)
      restored++
    }
    db.prepare("UPDATE agent_activity SET reverted_at = datetime('now') WHERE id = ?").run(id)
    return { reverted: true, files_restored: restored }
  })()
}
