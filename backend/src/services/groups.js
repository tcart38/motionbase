// Media groups: several clips shown as ONE entry in the Library (see migration 006).
// Every function expects to run inside a transaction when it writes several rows.
import { HttpError } from './errors.js'
import { recordEvent } from './history.js'
import { attachTags } from './fileQuery.js'

const META_LINE = /^(Author|Source|Platform|Posted|Title|Item \d+ of \d+( in this post)?)\b/i

// First line of the caption in notes written by the URL import (skips the Author/Source/... header lines).
export function captionSnippet(notes, max = 70) {
  if (!notes) return ''
  for (const line of String(notes).split(/\r?\n/)) {
    const l = line.trim()
    if (!l || META_LINE.test(l)) continue
    const s = l.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
    if (!s) continue
    return s.length > max ? `${s.slice(0, max - 1).trim()}…` : s
  }
  return ''
}

const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)

export function parseIds(v, { min = 1, max = 500, what = 'file_ids' } = {}) {
  if (!Array.isArray(v) || v.length < min || v.length > max || !v.every(Number.isInteger)) {
    throw new HttpError(400, `${what} must be ${min}-${max} integers`)
  }
  return [...new Set(v)]
}

export function getGroupRow(db, id) {
  return db.prepare('SELECT * FROM media_groups WHERE id = ?').get(id) || null
}

export const liveCount = (db, gid) =>
  db.prepare('SELECT COUNT(*) AS n FROM files WHERE group_id = ? AND deleted_at IS NULL AND is_missing = 0').get(gid).n

// Re-number positions 0..n-1 (stable by current position, then id).
function renumber(db, gid) {
  const rows = db.prepare('SELECT id FROM files WHERE group_id = ? ORDER BY group_position IS NULL, group_position, id').all(gid)
  const set = db.prepare('UPDATE files SET group_position = ? WHERE id = ?')
  rows.forEach((r, i) => set.run(i, r.id))
}

// Delete a group and release every member.
function dissolve(db, group, by, reason) {
  const members = db.prepare('SELECT id FROM files WHERE group_id = ?').all(group.id)
  db.prepare('UPDATE files SET group_id = NULL, group_position = NULL WHERE group_id = ?').run(group.id)
  db.prepare('DELETE FROM media_groups WHERE id = ?').run(group.id)
  for (const m of members) recordEvent(db, m.id, by, 'ungrouped', { group_id: group.id, title: group.title, ...(reason ? { reason } : {}) })
}

// A group with fewer than 2 live members stops being a group. countTrashed: only dissolve when fewer than
// 2 members remain at all (used after files are purged for good so trashed members keep their group).
export function dissolveIfSmall(db, gid, by, { countTrashed = false } = {}) {
  const group = getGroupRow(db, gid)
  if (!group) return false
  const n = countTrashed
    ? db.prepare('SELECT COUNT(*) AS n FROM files WHERE group_id = ?').get(gid).n
    : liveCount(db, gid)
  if (n >= 2) { renumber(db, gid); return false }
  dissolve(db, group, by, 'too_small')
  return true
}

function requireFiles(db, ids) {
  const rows = ids.map((id) => db.prepare('SELECT id, group_id, deleted_at, notes, filename FROM files WHERE id = ? AND is_missing = 0').get(id))
  const miss = ids.find((_, i) => !rows[i])
  if (miss !== undefined) throw new HttpError(404, `File ${miss} not found`)
  return rows
}

// Take files out of whatever groups they are in (events + auto-dissolve of the groups left too small).
function detach(db, rows, by, reason) {
  const touched = new Set()
  for (const r of rows) {
    if (!r.group_id) continue
    const g = getGroupRow(db, r.group_id)
    db.prepare('UPDATE files SET group_id = NULL, group_position = NULL WHERE id = ?').run(r.id)
    recordEvent(db, r.id, by, 'ungrouped', { group_id: r.group_id, title: g?.title ?? null, ...(reason ? { reason } : {}) })
    touched.add(r.group_id)
  }
  for (const gid of touched) {
    if (!db.prepare('SELECT 1 FROM files WHERE group_id = ?').get(gid)) db.prepare('DELETE FROM media_groups WHERE id = ?').run(gid)
    else dissolveIfSmall(db, gid, by)
  }
}

export function createGroup(db, fileIds, { title, by, userId = null } = {}) {
  const ids = parseIds(fileIds, { min: 2, what: 'file_ids' })
  const rows = requireFiles(db, ids)
  detach(db, rows.filter((r) => r.group_id), by, 'moved')
  const t = clean(title) || captionSnippet(rows[0].notes) || rows[0].filename
  const gid = Number(db.prepare('INSERT INTO media_groups (title, created_by) VALUES (?, ?)').run(t, userId).lastInsertRowid)
  const set = db.prepare('UPDATE files SET group_id = ?, group_position = ? WHERE id = ?')
  ids.forEach((id, i) => { set.run(gid, i, id); recordEvent(db, id, by, 'grouped', { group_id: gid, title: t }) })
  return gid
}

export function addToGroup(db, gid, fileIds, by) {
  const group = getGroupRow(db, gid)
  if (!group) throw new HttpError(404, 'Group not found')
  const ids = parseIds(fileIds)
  const rows = requireFiles(db, ids).filter((r) => r.group_id !== gid)
  detach(db, rows.filter((r) => r.group_id), by, 'moved')
  let pos = db.prepare('SELECT COALESCE(MAX(group_position), -1) AS p FROM files WHERE group_id = ?').get(gid).p
  const set = db.prepare('UPDATE files SET group_id = ?, group_position = ? WHERE id = ?')
  for (const r of rows) { set.run(gid, ++pos, r.id); recordEvent(db, r.id, by, 'grouped', { group_id: gid, title: group.title }) }
  return rows.length
}

export function removeFromGroup(db, gid, fileIds, by) {
  const group = getGroupRow(db, gid)
  if (!group) throw new HttpError(404, 'Group not found')
  const ids = parseIds(fileIds)
  const rows = requireFiles(db, ids).filter((r) => r.group_id === gid)
  detach(db, rows, by, 'removed')
  return rows.length
}

export function ungroup(db, gid, by) {
  const group = getGroupRow(db, gid)
  if (!group) throw new HttpError(404, 'Group not found')
  dissolve(db, group, by, null)
}

export function renameGroup(db, gid, title, by) {
  const group = getGroupRow(db, gid)
  if (!group) throw new HttpError(404, 'Group not found')
  const t = clean(title)
  if (!t) throw new HttpError(400, 'title cannot be empty')
  if (t === group.title) return
  db.prepare('UPDATE media_groups SET title = ? WHERE id = ?').run(t, gid)
  for (const m of db.prepare('SELECT id FROM files WHERE group_id = ?').all(gid)) {
    recordEvent(db, m.id, by, 'group_renamed', { from: group.title, to: t })
  }
}

// order: file ids in the wanted order; members not listed keep their relative order after them.
export function reorderGroup(db, gid, order) {
  if (!getGroupRow(db, gid)) throw new HttpError(404, 'Group not found')
  const ids = parseIds(order, { what: 'order' })
  const members = db.prepare('SELECT id FROM files WHERE group_id = ? ORDER BY group_position IS NULL, group_position, id').all(gid).map((r) => r.id)
  const memberSet = new Set(members)
  if (ids.some((id) => !memberSet.has(id))) throw new HttpError(400, 'order contains files that are not in the group')
  const next = [...ids, ...members.filter((id) => !ids.includes(id))]
  const set = db.prepare('UPDATE files SET group_position = ? WHERE id = ?')
  next.forEach((id, i) => set.run(i, id))
}

// { id, title, created_at, created_by, size (live), members: [file + tags] } ordered by position.
export function describeGroup(db, gid) {
  const g = getGroupRow(db, gid)
  if (!g) return null
  const rows = db.prepare('SELECT * FROM files WHERE group_id = ? AND is_missing = 0 ORDER BY group_position IS NULL, group_position, id').all(gid)
  const members = attachTags(db, rows)
  return {
    id: g.id, title: g.title, created_by: g.created_by, created_at: g.created_at,
    size: members.filter((m) => !m.deleted_at).length, members,
  }
}

// Expand file ids to every member of their groups. live=true -> non-trashed members, false -> trashed ones.
export function expandGroups(db, ids, { live = true } = {}) {
  const out = []
  const seen = new Set()
  const push = (id) => { if (!seen.has(id)) { seen.add(id); out.push(id) } }
  const state = live ? 'deleted_at IS NULL' : 'deleted_at IS NOT NULL'
  for (const id of ids) {
    push(id)
    const f = db.prepare('SELECT group_id FROM files WHERE id = ?').get(id)
    if (!f?.group_id) continue
    for (const m of db.prepare(`SELECT id FROM files WHERE group_id = ? AND is_missing = 0 AND ${state} ORDER BY group_position, id`).all(f.group_id)) push(m.id)
  }
  return out
}

// One group for the files of a multi-item post import, ordered as given. No-op for < 2 files.
export function groupImportedFiles(db, filenames, { title, by, userId = null } = {}) {
  const ids = []
  for (const name of filenames) {
    const r = db.prepare('SELECT id FROM files WHERE filename = ? AND group_id IS NULL AND is_missing = 0').get(name)
    if (r) ids.push(r.id)
  }
  if (ids.length < 2) return null
  return db.transaction(() => createGroup(db, ids, { title, by, userId }))()
}

// Title for an imported post: "<Author>: <caption snippet>".
export function postGroupTitle(post, fallback = 'LinkedIn post') {
  const cap = captionSnippet(post?.description, 60)
  const author = clean(post?.author)
  if (author && cap) return `${author}: ${cap}`
  return author || cap || fallback
}
