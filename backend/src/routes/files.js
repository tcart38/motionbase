import { Router } from 'express'
import { createReadStream, statSync, renameSync, existsSync, rmSync } from 'fs'
import path from 'path'
import { getDb } from '../db/index.js'
import { orderBy, buildFileFilter, attachTags, getFileWithTags, collapsedSource } from '../services/fileQuery.js'
import { config } from '../config.js'
import { HttpError } from '../services/errors.js'
import { applyFileUpdate, validateChanges } from '../services/fileMutations.js'
import { requireAdmin } from '../middleware/session.js'
import { actorFromReq, recordEvent, getHistory } from '../services/history.js'
import { audit, userActor } from '../services/auth.js'
import { expandGroups, dissolveIfSmall } from '../services/groups.js'

const truthy = (v) => v === true || v === 1 || ['1', 'true', 'yes'].includes(String(v).toLowerCase())

const router = Router()

// GET /api/files?view=all|inbox&tags=1,2,3&sort=date_added&order=desc&page=1&limit=50
router.get('/', (req, res) => {
  const db = getDb()
  const {
    view = 'all',
    tags = '',
    sort = 'date_added',
    order = 'desc',
    page = '1',
    limit = '50',
    search = '',
    favorites = '',
    untagged = '',
    folder = '',
    subfolders = '',
    status = '',
    source = '',
    trash = '',
    uploader = '',
    group = '',
    collapse = '',
  } = req.query

  const sortDir = order === 'asc' ? 'ASC' : 'DESC'

  const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10))
  const limitVal = Math.max(1, parseInt(limit, 10))

  const { where, params: allParams } = buildFileFilter(db, { view, tags, search, favorites, untagged, folder, subfolders, status, source, trash, uploader, group })

  let total, rows
  if (truthy(collapse)) {
    const c = collapsedSource(where)
    total = db.prepare(`${c.with} SELECT COUNT(*) AS total FROM ${c.from}`).get(...allParams).total
    rows = db.prepare(`${c.with} SELECT f.* FROM ${c.from} ORDER BY ${orderBy(sort, order)}, f.id ${sortDir} LIMIT ? OFFSET ?`).all(...allParams, limitVal, offset)
    for (const r of rows) delete r.rn
  } else {
    total = db.prepare(`SELECT COUNT(*) AS total FROM files f WHERE ${where}`).get(...allParams).total
    // A group's members list in their group order
    const ord = group !== '' ? 'f.group_position IS NULL, f.group_position, f.id' : orderBy(sort, order)
    rows = db.prepare(`SELECT f.* FROM files f WHERE ${where} ORDER BY ${ord} LIMIT ? OFFSET ?`).all(...allParams, limitVal, offset)
  }

  const files = attachTags(db, rows)

  res.json({ files, total, page: parseInt(page, 10), limit: limitVal })
})

// GET /api/files/counts -> { inbox, needs_review, total }
// inbox = not yet confirmed by a person (includes files an agent reviewed that await confirmation).
router.get('/counts', (req, res) => {
  const db = getDb()
  const one = (where) => db.prepare(`SELECT COUNT(*) AS n FROM files f WHERE f.is_missing = 0 AND f.deleted_at IS NULL ${where}`).get().n
  res.json({
    inbox: one('AND f.reviewed_at IS NULL'),
    needs_review: one('AND f.reviewed_at IS NULL AND f.agent_reviewed_at IS NOT NULL'),
    total: one(''),
    trash: db.prepare('SELECT COUNT(*) AS n FROM files WHERE is_missing = 0 AND deleted_at IS NOT NULL').get().n,
  })
})

// POST /api/files/trash { file_ids: [..<=500], deleted: true|false }
// Soft delete (default) or restore. Nothing is removed from disk; the scanner keeps ignoring trashed files.
router.post('/trash', (req, res) => {
  const db = getDb()
  const { deleted = true, expand_groups } = req.body || {}
  let { file_ids } = req.body || {}
  if (!Array.isArray(file_ids) || file_ids.length === 0 || file_ids.length > 500 || !file_ids.every(Number.isInteger)) {
    throw new HttpError(400, 'file_ids must be 1-500 integers')
  }
  // expand_groups: acting on one member of a group acts on all of its live (or, for a restore, trashed) members
  if (truthy(expand_groups)) {
    file_ids = expandGroups(db, file_ids, { live: !!deleted })
    if (file_ids.length > 500) throw new HttpError(413, 'At most 500 files per request')
  }
  const stamp = deleted ? new Date().toISOString() : null
  const updated = db.transaction(() => {
    const upd = db.prepare('UPDATE files SET deleted_at = ? WHERE id = ?')
    const by = actorFromReq(req)
    let n = 0
    for (const id of file_ids) {
      const f = db.prepare('SELECT deleted_at FROM files WHERE id = ?').get(id)
      if (!f) throw new HttpError(404, `File ${id} not found`)
      n += upd.run(stamp, id).changes
      if (!!f.deleted_at !== !!deleted) recordEvent(db, id, by, deleted ? 'trashed' : 'restored')
    }
    return n
  })()
  res.json({ updated, deleted: !!deleted, file_ids })
})

// POST /api/files/purge { file_ids } or { all: true }
// Permanently deletes TRASHED files: removes the media file from disk, its thumbnail/frames and the record.
// If the media folder is read-only the file stays in the Trash and is reported under `failed`.
router.post('/purge', requireAdmin, (req, res) => {
  const db = getDb()
  const { file_ids, all } = req.body || {}
  let rows
  if (all === true) {
    rows = db.prepare('SELECT * FROM files WHERE deleted_at IS NOT NULL').all()
  } else {
    if (!Array.isArray(file_ids) || file_ids.length === 0 || file_ids.length > 500 || !file_ids.every(Number.isInteger)) {
      throw new HttpError(400, 'file_ids must be 1-500 integers, or pass all: true')
    }
    rows = file_ids.map((id) => db.prepare('SELECT * FROM files WHERE id = ? AND deleted_at IS NOT NULL').get(id)).filter(Boolean)
  }
  const purged = []
  const failed = []
  for (const file of rows) {
    try {
      rmSync(file.filepath, { force: true })
    } catch (err) {
      failed.push({ id: file.id, filename: file.filename, error: err.code === 'EROFS' || err.code === 'EACCES' || err.code === 'EPERM' ? 'Media folder is read-only' : err.message })
      continue
    }
    db.prepare('DELETE FROM files WHERE id = ?').run(file.id)
    if (file.group_id) dissolveIfSmall(db, file.group_id, actorFromReq(req), { countTrashed: true })
    try { rmSync(file.thumbnail_path || path.join(config.thumbnailsDir, `${file.id}.jpg`), { force: true }) } catch {}
    try { rmSync(path.join(config.framesDir, String(file.id)), { recursive: true, force: true }) } catch {}
    purged.push(file.id)
  }
  if (purged.length || failed.length) {
    audit(db, userActor(req.user), 'purge', {
      count: purged.length, failed: failed.length,
      files: rows.filter((f) => purged.includes(f.id)).slice(0, 200).map((f) => ({ id: f.id, filename: f.filename })),
    })
  }
  res.json({ purged: purged.length, failed })
})

// POST /api/files/bulk
// { file_ids: [..<=500], add_tag_ids, remove_tag_ids, folder_id (null = unfile), is_favorite, mark_reviewed }
// Applied atomically: either every file is updated or none.
router.post('/bulk', (req, res) => {
  const db = getDb()
  const { file_ids, add_tag_ids, remove_tag_ids, folder_id, is_favorite, mark_reviewed, expand_groups } = req.body
  if (!Array.isArray(file_ids) || file_ids.length === 0) throw new HttpError(400, 'file_ids must be a non-empty array')
  if (file_ids.length > 500) throw new HttpError(413, 'At most 500 files per request')
  let ids = [...new Set(file_ids.map(Number))]
  if (ids.some((n) => !Number.isInteger(n))) throw new HttpError(400, 'file_ids must be integers')
  // expand_groups: each id stands for all live members of its group
  if (truthy(expand_groups)) {
    ids = expandGroups(db, ids)
    if (ids.length > 500) throw new HttpError(413, 'At most 500 files per request')
  }

  const changes = { add_tag_ids, remove_tag_ids, folder_id, is_favorite, mark_reviewed: mark_reviewed || undefined }
  validateChanges(db, changes)

  const by = actorFromReq(req)
  const updated = db.transaction(() => {
    let n = 0
    for (const id of ids) {
      const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id)
      if (!file) throw new HttpError(404, `File ${id} not found`)
      applyFileUpdate(db, file, changes, { by })
      n++
    }
    return n
  })()
  res.json({ updated, file_ids: ids })
})

// GET /api/files/:id/history -> { events: [{id, action, actor:{user_id,label}, detail, created_at}], uploaded:{at, by, source} }
router.get('/:id/history', (req, res) => {
  const h = getHistory(getDb(), Number(req.params.id), { limit: req.query.limit })
  if (!h) return res.status(404).json({ error: 'Not found' })
  res.json(h)
})

router.get('/:id', (req, res) => {
  const file = getFileWithTags(getDb(), req.params.id)
  if (!file) return res.status(404).json({ error: 'Not found' })
  res.json(file)
})

// GET /api/files/:id/next — id of the next file in the current filtered/sorted view (wraps around).
// collapse=1 steps over groups: the rest of the current file's group is skipped.
router.get('/:id/next', (req, res) => {
  const db = getDb()
  const { view = 'all', tags = '', sort = 'date_added', order = 'desc', search = '', favorites = '', untagged = '', folder = '', subfolders = '', status = '', source = '', trash = '', uploader = '', collapse = '' } = req.query

  const sortDir = order === 'asc' ? 'ASC' : 'DESC'

  const { where, params } = buildFileFilter(db, { view, tags, search, favorites, untagged, folder, subfolders, status, source, trash, uploader })

  let list
  if (truthy(collapse)) {
    const c = collapsedSource(where)
    list = db.prepare(`${c.with} SELECT f.id, f.group_id FROM ${c.from} ORDER BY ${orderBy(sort, order)}, f.id ${sortDir}`).all(...params)
  } else {
    list = db.prepare(`SELECT f.id, f.group_id FROM files f WHERE ${where} ORDER BY ${orderBy(sort, order)}, f.id ${sortDir}`).all(...params)
  }

  if (list.length === 0) return res.status(404).json({ error: 'No files match the current filter' })

  const curId = Number(req.params.id)
  let currentIdx = list.findIndex((r) => r.id === curId)
  if (currentIdx === -1 && truthy(collapse)) {
    // the current file is another member of a collapsed group: continue from the group's entry
    const gid = db.prepare('SELECT group_id FROM files WHERE id = ?').get(curId)?.group_id
    if (gid) currentIdx = list.findIndex((r) => r.group_id === gid)
  }
  const nextId = currentIdx === -1 ? list[0].id : list[(currentIdx + 1) % list.length].id

  res.json({ nextId, total: list.length })
})

// PATCH /api/files/:id — update needs_tagging, tags, or filename
router.patch('/:id', (req, res) => {
  const db = getDb()
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id)
  if (!file) return res.status(404).json({ error: 'Not found' })

  const { needs_tagging, tag_ids, filename, is_favorite, notes, folder_id, mark_reviewed } = req.body

  if (filename !== undefined) {
    const newName = String(filename).trim()
    if (!newName) return res.status(400).json({ error: 'Filename cannot be empty' })
    const newFilepath = path.join(path.dirname(file.filepath), newName)
    if (newFilepath !== file.filepath) {
      if (existsSync(newFilepath)) return res.status(409).json({ error: 'A file with that name already exists' })
      try {
        renameSync(file.filepath, newFilepath)
      } catch (err) {
        return res.status(500).json({ error: 'Could not rename file: ' + err.message })
      }
      db.prepare('UPDATE files SET filename = ?, filepath = ? WHERE id = ?').run(newName, newFilepath, file.id)
      recordEvent(db, file.id, actorFromReq(req), 'renamed', { from: file.filename, to: newName })
    }
  }

  const changes = { needs_tagging, tag_ids, is_favorite, notes, folder_id, mark_reviewed }
  validateChanges(db, changes)
  db.transaction(() => applyFileUpdate(db, file, changes, { by: actorFromReq(req) }))()

  res.json(getFileWithTags(db, file.id))
})

// DELETE /api/files/:id — permanently remove a missing file record
router.delete('/:id', (req, res) => {
  const db = getDb()
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id)
  if (!file) return res.status(404).json({ error: 'Not found' })
  db.prepare('DELETE FROM files WHERE id = ?').run(file.id)
  if (file.group_id) dissolveIfSmall(db, file.group_id, actorFromReq(req), { countTrashed: true })
  audit(db, userActor(req.user), 'purge', { count: 1, record_only: true, files: [{ id: file.id, filename: file.filename }] })
  // Remove derived artifacts (thumbnail + cached frames); the media file itself is untouched.
  try { rmSync(file.thumbnail_path || path.join(config.thumbnailsDir, `${file.id}.jpg`), { force: true }) } catch {}
  try { rmSync(path.join(config.framesDir, String(file.id)), { recursive: true, force: true }) } catch {}
  res.json({ deleted: true })
})

// GET /api/files/:id/download — download the file as an attachment
router.get('/:id/download', (req, res) => {
  const db = getDb()
  const file = db.prepare('SELECT filepath, filename FROM files WHERE id = ?').get(req.params.id)
  if (!file) return res.status(404).json({ error: 'Not found' })

  let stat
  try {
    stat = statSync(file.filepath)
  } catch {
    return res.status(404).json({ error: 'File not found on disk' })
  }

  const safeName = file.filename.replace(/["\\\r\n]/g, '_')
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`)
  res.setHeader('Content-Length', stat.size)
  res.setHeader('Content-Type', 'application/octet-stream')
  createReadStream(file.filepath).pipe(res)
})

// GET /api/files/:id/stream — stream the media file with Range support
router.get('/:id/stream', (req, res) => {
  const db = getDb()
  const file = db.prepare('SELECT filepath, file_type FROM files WHERE id = ?').get(req.params.id)
  if (!file) return res.status(404).json({ error: 'Not found' })

  let stat
  try {
    stat = statSync(file.filepath)
  } catch {
    return res.status(404).json({ error: 'File not found on disk' })
  }

  const ext = file.filepath.split('.').pop().toLowerCase()
  const mimeMap = {
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
    mkv: 'video/x-matroska', webm: 'video/webm', m4v: 'video/mp4',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp',
  }
  const contentType = mimeMap[ext] || 'application/octet-stream'
  const total = stat.size
  const range = req.headers.range

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
    const start = parseInt(startStr, 10)
    const end = endStr ? parseInt(endStr, 10) : total - 1
    const chunkSize = end - start + 1

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    })
    createReadStream(file.filepath, { start, end }).pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    })
    createReadStream(file.filepath).pipe(res)
  }
})

export default router
