// Shared write path for file metadata (used by the UI routes and the agent API).
// Filename changes touch the disk and stay in the route.
import { HttpError } from './errors.js'
import { getPathMap } from './folders.js'
import { recordEvent, describeTags, truncate } from './history.js'

export function getSystemTagIds(db) {
  return new Set(db.prepare(`
    SELECT t.id FROM tags t JOIN tag_categories c ON c.id = t.category_id WHERE c.is_system = 1
  `).all().map((r) => r.id))
}

export function getFileTagIds(db, fileId) {
  return db.prepare('SELECT tag_id FROM file_tags WHERE file_id = ?').all(fileId).map((r) => r.tag_id)
}

// Compute the resulting tag id list from the current tags and a change set:
//   tag_ids        replace the whole set (system tags are kept when protectSystem)
//   add_tag_ids    add
//   remove_tag_ids remove
// With protectSystem (agents), system-category tags are never added, removed or replaced.
export function computeTagSet(currentIds, changes, { systemIds = new Set(), protectSystem = false } = {}) {
  const { tag_ids, add_tag_ids, remove_tag_ids } = changes
  const ok = (id) => !(protectSystem && systemIds.has(id))
  let set = new Set(currentIds)
  if (Array.isArray(tag_ids)) {
    const keep = protectSystem ? currentIds.filter((id) => systemIds.has(id)) : []
    set = new Set([...keep, ...tag_ids.map(Number).filter(ok)])
  }
  for (const id of (add_tag_ids || []).map(Number)) if (ok(id)) set.add(id)
  for (const id of (remove_tag_ids || []).map(Number)) if (ok(id)) set.delete(id)
  return [...set]
}

// Set the file's tag list to exactly `tagIds`, touching only the difference. New links get `source`.
export function setFileTags(db, fileId, tagIds, source = 'user') {
  const want = new Set(tagIds.map(Number))
  const have = new Set(getFileTagIds(db, fileId))
  const del = db.prepare('DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?')
  const ins = db.prepare('INSERT OR IGNORE INTO file_tags (file_id, tag_id, source) VALUES (?, ?, ?)')
  for (const id of have) if (!want.has(id)) del.run(fileId, id)
  for (const id of want) if (!have.has(id)) ins.run(fileId, id, source)
}

export function mergeNotes(existing, incoming, mode = 'replace') {
  if (incoming === undefined) return undefined
  const next = incoming ?? null
  if (mode === 'append' && next) return existing ? `${existing}\n\n${next}` : next
  return next
}

// actor: 'user' | 'agent:<name>' (stored in reviewed_by / tag source)
// by:    { user_id, token_id, label } who is making the change, for the file history (see services/history.js)
// changes: { needs_tagging, tag_ids, add_tag_ids, remove_tag_ids, is_favorite,
//            notes, notes_mode, folder_id, mark_reviewed }
// Caller must validate that referenced tag/folder ids exist and run inside a transaction.
export function applyFileUpdate(db, file, changes, opts = {}) {
  const { by } = opts
  const before = db.prepare(
    'SELECT is_favorite, notes, folder_id, reviewed_at, needs_tagging, agent_reviewed_at FROM files WHERE id = ?'
  ).get(file.id)
  const tagsBefore = getFileTagIds(db, file.id)
  applyChanges(db, file, changes, opts)
  logChanges(db, file.id, before, tagsBefore, by)
}

// Compares the file with its pre-change snapshot and records one event per kind of change.
function logChanges(db, fileId, before, tagsBefore, by) {
  if (!before) return
  const after = db.prepare(
    'SELECT is_favorite, notes, folder_id, reviewed_at, reviewed_by, needs_tagging, agent_reviewed_at FROM files WHERE id = ?'
  ).get(fileId)
  if (!!after.is_favorite !== !!before.is_favorite) {
    recordEvent(db, fileId, by, 'favorite_changed', { from: !!before.is_favorite, to: !!after.is_favorite })
  }
  if ((after.notes ?? null) !== (before.notes ?? null)) {
    recordEvent(db, fileId, by, 'notes_changed', { from: truncate(before.notes), to: truncate(after.notes) })
  }
  if ((after.folder_id ?? null) !== (before.folder_id ?? null)) {
    const paths = getPathMap(db)
    recordEvent(db, fileId, by, 'folder_changed', {
      from_path: before.folder_id ? paths.get(before.folder_id) ?? null : null,
      to_path: after.folder_id ? paths.get(after.folder_id) ?? null : null,
    })
  }
  const tagsAfter = getFileTagIds(db, fileId)
  const was = new Set(tagsBefore), now = new Set(tagsAfter)
  const addedIds = tagsAfter.filter((id) => !was.has(id)), removedIds = tagsBefore.filter((id) => !now.has(id))
  if (addedIds.length || removedIds.length) {
    recordEvent(db, fileId, by, 'tags_changed', { added: describeTags(db, addedIds), removed: describeTags(db, removedIds) })
  }
  if (after.reviewed_at && !before.reviewed_at) recordEvent(db, fileId, by, 'reviewed', { by: after.reviewed_by })
  else if (!after.reviewed_at && before.reviewed_at) recordEvent(db, fileId, by, 'unreviewed')
  if (after.agent_reviewed_at && after.agent_reviewed_at !== before.agent_reviewed_at) {
    recordEvent(db, fileId, by, 'agent_update', { agent_reviewed: true, awaiting_confirmation: !after.reviewed_at })
  }
}

function applyChanges(db, file, changes, { actor = 'user', systemIds, requireConfirmation = false } = {}) {
  const { needs_tagging, is_favorite, notes, notes_mode, folder_id, mark_reviewed } = changes
  const isAgent = actor !== 'user'

  if (is_favorite !== undefined) {
    db.prepare('UPDATE files SET is_favorite = ? WHERE id = ?').run(is_favorite ? 1 : 0, file.id)
  }

  const newNotes = mergeNotes(file.notes, notes, notes_mode)
  if (newNotes !== undefined) {
    db.prepare('UPDATE files SET notes = ? WHERE id = ?').run(newNotes, file.id)
  }

  if (folder_id !== undefined) {
    db.prepare('UPDATE files SET folder_id = ? WHERE id = ?').run(folder_id ?? null, file.id)
  }

  const touchesTags = ['tag_ids', 'add_tag_ids', 'remove_tag_ids'].some((k) => Array.isArray(changes[k]))
  if (touchesTags) {
    const sys = systemIds || getSystemTagIds(db)
    const next = computeTagSet(getFileTagIds(db, file.id), changes, { systemIds: sys, protectSystem: isAgent })
    setFileTags(db, file.id, next, isAgent ? 'agent' : 'user')
  }

  if (isAgent && mark_reviewed) {
    // Agents always stamp agent_reviewed_at and release any lease. Unless the user wants to
    // confirm AI work first, that also counts as reviewed (the file leaves the Inbox).
    db.prepare(`
      UPDATE files SET agent_reviewed_at = datetime('now'), lease_owner = NULL, lease_until = NULL WHERE id = ?
    `).run(file.id)
    if (!requireConfirmation) markReviewed(db, file.id, actor)
    return
  }

  if (needs_tagging !== undefined) {
    if (needs_tagging) {
      db.prepare('UPDATE files SET needs_tagging = 1, reviewed_at = NULL, reviewed_by = NULL WHERE id = ?').run(file.id)
    } else {
      markReviewed(db, file.id, actor)
    }
  }
  if (mark_reviewed) markReviewed(db, file.id, actor)
}

function markReviewed(db, fileId, actor) {
  db.prepare(`
    UPDATE files SET needs_tagging = 0, reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?
  `).run(actor, fileId)
}

// Validate a change-set's references (tag ids, folder id). Throws HttpError(400/404).
export function validateChanges(db, changes) {
  const ids = [...(changes.tag_ids || []), ...(changes.add_tag_ids || []), ...(changes.remove_tag_ids || [])]
  for (const k of ['tag_ids', 'add_tag_ids', 'remove_tag_ids']) {
    if (changes[k] !== undefined && !Array.isArray(changes[k])) throw new HttpError(400, `${k} must be an array`)
  }
  if (ids.length) {
    const uniq = [...new Set(ids.map(Number))]
    if (uniq.some((n) => !Number.isInteger(n))) throw new HttpError(400, 'Tag ids must be integers')
    const found = db.prepare(`SELECT id FROM tags WHERE id IN (${uniq.map(() => '?').join(',')})`).all(...uniq)
    if (found.length !== uniq.length) throw new HttpError(404, 'One or more tags not found')
  }
  if (changes.folder_id != null) {
    if (!db.prepare('SELECT 1 FROM folders WHERE id = ?').get(changes.folder_id)) {
      throw new HttpError(404, 'Folder not found')
    }
  }
}
