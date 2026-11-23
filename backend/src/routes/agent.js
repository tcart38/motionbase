import { Router } from 'express'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { agentAuth } from '../middleware/agentAuth.js'
import { HttpError } from '../services/errors.js'
import { buildFileFilter, uploadersFor, groupInfoFor } from '../services/fileQuery.js'
import { getTree, getPathMap, findByPath, ensurePath, getFolder } from '../services/folders.js'
import { runBatch, requiresConfirmation, MAX_BATCH } from '../services/agentUpdates.js'
import { listActivity, getActivity, logActivity } from '../services/activity.js'
import {
  ffmpegAvailable, clampInt, getFrame, getContactSheet, getFrameTimes, effectiveCount,
  MAX_FRAMES, MAX_WIDTH,
} from '../services/frames.js'
import { buildOpenApi } from '../agent/openapi.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8'))

const router = Router()
// Express 4 does not catch rejected promises from async handlers.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
export const BASE = '/api/agent/v1'
const STATUSES = ['pending', 'untagged', 'needs_review', 'agent_reviewed', 'reviewed', 'all']

// ---- public discovery -------------------------------------------------------

router.get('/', (req, res) => {
  res.json({
    name: 'MotionBase Agent API',
    version,
    base_url: BASE,
    auth: 'Authorization: Bearer mb_... (create a token in Settings > Agent API)',
    openapi: `${BASE}/openapi.json`,
    docs: 'docs/AGENT_API.md in the repository',
    endpoints: [
      'GET /status', 'GET /taxonomy',
      'GET /files', 'GET /files/{id}', 'PATCH /files/{id}',
      'GET /files/{id}/frames', 'GET /files/{id}/frames/{i}.jpg',
      'GET /files/{id}/contact-sheet.jpg', 'GET /files/{id}/thumbnail.jpg',
      'POST /files/bulk', 'POST /files/apply', 'POST /files/review',
      'POST /queue/claim', 'POST /queue/release',
      'POST /categories', 'POST /tags', 'POST /folders', 'GET /activity',
    ],
  })
})

router.get('/openapi.json', (req, res) => res.json(buildOpenApi(version)))

router.use(agentAuth)

// ---- helpers ----------------------------------------------------------------

function parseId(v) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Invalid id')
  return n
}

function requireFile(db, id) {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(id)
  if (!f || f.deleted_at) throw new HttpError(404, 'File not found')
  return f
}

function relPath(filepath) {
  const rel = path.relative(config.mediaDir, filepath)
  return rel.startsWith('..') ? path.basename(filepath) : rel.split(path.sep).join('/')
}

function reviewStatus(f) {
  if (f.reviewed_at) return 'reviewed'
  if (f.agent_reviewed_at) return 'needs_review'
  return 'pending'
}

function serializeFiles(db, rows) {
  if (rows.length === 0) return []
  const pathMap = getPathMap(db)
  const ids = rows.map((r) => r.id)
  const tagRows = db.prepare(`
    SELECT ft.file_id, ft.source, t.id, t.name, c.id AS category_id, c.name AS category
    FROM file_tags ft JOIN tags t ON t.id = ft.tag_id JOIN tag_categories c ON c.id = t.category_id
    WHERE ft.file_id IN (${ids.map(() => '?').join(',')}) ORDER BY c.name, t.name
  `).all(...ids)
  const byFile = {}
  for (const t of tagRows) {
    ;(byFile[t.file_id] = byFile[t.file_id] || []).push(
      { id: t.id, name: t.name, category_id: t.category_id, category: t.category, source: t.source }
    )
  }
  const uploaders = uploadersFor(db, rows)
  const groups = groupInfoFor(db, rows)
  const now = new Date().toISOString()
  return rows.map((f) => {
    const tags = byFile[f.id] || []
    const prefix = `${BASE}/files/${f.id}`
    return {
      id: f.id,
      filename: f.filename,
      path: relPath(f.filepath),
      file_type: f.file_type,
      duration: f.duration, width: f.width, height: f.height, fps: f.fps,
      aspect_ratio: f.aspect_ratio, file_size: f.file_size, date_added: f.date_added,
      is_missing: !!f.is_missing,
      is_favorite: !!f.is_favorite,
      notes: f.notes,
      uploader: f.uploaded_by ? uploaders.get(f.uploaded_by)?.display_name ?? null : null,
      upload_source: f.upload_source ?? null,
      group_id: f.group_id ?? null,
      group_title: f.group_id ? groups.get(f.group_id)?.title ?? null : null,
      group_position: f.group_id ? f.group_position ?? null : null,
      group_size: f.group_id ? groups.get(f.group_id)?.size ?? 0 : null,
      folder_id: f.folder_id,
      folder_path: f.folder_id ? pathMap.get(f.folder_id) ?? null : null,
      tags,
      tags_by_category: tags.reduce((acc, t) => ((acc[t.category] = acc[t.category] || []).push(t.name), acc), {}),
      review: {
        status: reviewStatus(f),
        needs_tagging: !!f.needs_tagging,
        reviewed_at: f.reviewed_at, reviewed_by: f.reviewed_by,
        agent_reviewed_at: f.agent_reviewed_at,
      },
      lease: f.lease_owner && f.lease_until > now ? { owner: f.lease_owner, until: f.lease_until } : null,
      urls: {
        thumbnail: `${prefix}/thumbnail.jpg`,
        frames: `${prefix}/frames`,
        contact_sheet: `${prefix}/contact-sheet.jpg`,
      },
    }
  })
}

const fileById = (db, id) => serializeFiles(db, [requireFile(db, id)])[0]

// ---- status / taxonomy -------------------------------------------------------

router.get('/status', wrap(async (req, res) => {
  const db = getDb()
  const count = (status) => {
    const { where, params } = buildFileFilter(db, { status })
    return db.prepare(`SELECT COUNT(*) AS n FROM files f WHERE ${where}`).get(...params).n
  }
  const now = new Date().toISOString()
  const { leased } = db.prepare(
    'SELECT COUNT(*) AS leased FROM files WHERE is_missing = 0 AND deleted_at IS NULL AND lease_until > ?'
  ).get(now)
  res.json({
    version,
    server_time: now,
    agent: req.agent.name,
    requires_confirmation: requiresConfirmation(db),
    ffmpeg: await ffmpegAvailable(),
    counts: Object.fromEntries(STATUSES.map((s) => [s, count(s)])),
    leased,
  })
}))

router.get('/taxonomy', (req, res) => {
  const db = getDb()
  const cats = db.prepare('SELECT * FROM tag_categories ORDER BY name COLLATE NOCASE').all()
  const tags = db.prepare(`
    SELECT t.id, t.category_id, t.name, t.description, COUNT(ft.file_id) AS file_count
    FROM tags t LEFT JOIN file_tags ft ON ft.tag_id = t.id GROUP BY t.id ORDER BY t.name COLLATE NOCASE
  `).all()
  const pathMap = getPathMap(db)
  const { folders, unfiled_count } = getTree(db)
  res.json({
    categories: cats.map((c) => ({
      id: c.id, name: c.name, description: c.description, selection: c.selection,
      is_system: !!c.is_system, // system categories are read-only for agents
      tags: tags.filter((t) => t.category_id === c.id).map(({ category_id, ...t }) => t),
    })),
    folders: folders.map((f) => ({
      id: f.id, parent_id: f.parent_id, name: f.name, path: pathMap.get(f.id),
      file_count: f.file_count, total_count: f.total_count,
    })),
    unfiled_count,
  })
})

// ---- files -------------------------------------------------------------------

function resolveFolderParam(db, folder) {
  if (folder === undefined || folder === '' || folder === 'none') return folder || ''
  if (/^\d+$/.test(folder)) return folder
  const f = findByPath(db, folder)
  if (!f) throw new HttpError(404, `Folder "${folder}" not found`)
  return String(f.id)
}

router.get('/files', (req, res) => {
  const db = getDb()
  const { status = 'all', folder, subfolders = '1', tags = '', search = '', favorites = '', uploader = '', cursor } = req.query
  if (!STATUSES.includes(status)) throw new HttpError(400, `status must be one of ${STATUSES.join(', ')}`)
  const limit = clampInt(req.query.limit, 50, 1, 200)

  const { where, params } = buildFileFilter(db, {
    status: status === 'all' ? '' : status,
    folder: resolveFolderParam(db, folder), subfolders, tags, search, favorites, uploader,
  })
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM files f WHERE ${where}`).get(...params)
  const after = cursor ? clampInt(cursor, 0, 0, Number.MAX_SAFE_INTEGER) : 0
  const rows = db.prepare(
    `SELECT f.* FROM files f WHERE ${where} AND f.id > ? ORDER BY f.id LIMIT ?`
  ).all(...params, after, limit + 1)
  const page = rows.slice(0, limit)
  res.json({
    files: serializeFiles(db, page),
    total,
    next_cursor: rows.length > limit ? page.at(-1).id : null,
  })
})

// Batch + review routes are declared before /files/:id.
router.post('/files/bulk', (req, res) => {
  const { status, body } = runBatch(getDb(), req.body || {}, { agent: req.agent, action: 'files.bulk' })
  res.status(status).json(body)
})

const CHANGE_FIELDS = [
  'add_tag_ids', 'remove_tag_ids', 'set_tag_ids', 'add_tags', 'remove_tags', 'set_category_tags',
  'notes', 'notes_mode', 'folder_id', 'folder_path', 'favorite', 'mark_reviewed',
]

// Apply one identical change to many files: { file_ids, ...change fields, create_missing, dry_run }
router.post('/files/apply', (req, res) => {
  const { file_ids, create_missing, dry_run, ...rest } = req.body || {}
  if (!Array.isArray(file_ids) || file_ids.length === 0) throw new HttpError(400, 'file_ids must be a non-empty array')
  if (file_ids.length > MAX_BATCH) throw new HttpError(413, `At most ${MAX_BATCH} files per request`)
  const unknown = Object.keys(rest).filter((k) => !CHANGE_FIELDS.includes(k))
  if (unknown.length) throw new HttpError(400, `Unknown field(s): ${unknown.join(', ')}`)
  const updates = file_ids.map((file_id) => ({ file_id, ...rest }))
  const { status, body } = runBatch(getDb(), { updates, create_missing, dry_run }, { agent: req.agent, action: 'files.apply' })
  res.status(status).json(body)
})

// Mark files reviewed: { file_ids, dry_run }
router.post('/files/review', (req, res) => {
  const { file_ids, dry_run } = req.body || {}
  if (!Array.isArray(file_ids) || file_ids.length === 0) throw new HttpError(400, 'file_ids must be a non-empty array')
  const updates = file_ids.map((file_id) => ({ file_id, mark_reviewed: true }))
  const { status, body } = runBatch(getDb(), { updates, dry_run }, { agent: req.agent, action: 'files.review' })
  res.status(status).json(body)
})

router.get('/files/:id', (req, res) => {
  res.json(fileById(getDb(), parseId(req.params.id)))
})

router.patch('/files/:id', (req, res) => {
  const db = getDb()
  const id = parseId(req.params.id)
  requireFile(db, id)
  const { create_missing, dry_run, ...rest } = req.body || {}
  const { status, body } = runBatch(
    db, { updates: [{ file_id: id, ...rest }], create_missing, dry_run }, { agent: req.agent, action: 'files.update' }
  )
  if (status !== 200) return res.status(status).json(body)
  res.json({ ...body, file: fileById(db, id) })
})

// ---- frames ------------------------------------------------------------------

function frameParams(req, file) {
  return {
    count: clampInt(req.query.count, 8, 1, MAX_FRAMES),
    width: clampInt(req.query.width, 640, 64, MAX_WIDTH),
  }
}

router.get('/files/:id/frames', (req, res) => {
  const db = getDb()
  const file = requireFile(db, parseId(req.params.id))
  const { count, width } = frameParams(req, file)
  const n = effectiveCount(file, count)
  const times = getFrameTimes(file, n)
  const prefix = `${BASE}/files/${file.id}`
  res.json({
    file_id: file.id, file_type: file.file_type, duration: file.duration, count: n, width,
    frames: times.map((t, i) => ({ index: i, time_seconds: t, url: `${prefix}/frames/${i}.jpg?count=${n}&width=${width}` })),
    contact_sheet_url: `${prefix}/contact-sheet.jpg?count=${n}&cols=${Math.min(3, n)}`,
  })
})

function sendJpeg(res, file, headers = {}) {
  res.set({ 'Cache-Control': 'private, max-age=300', ...headers })
  res.type('image/jpeg').sendFile(file)
}

router.get('/files/:id/frames/:index.jpg', wrap(async (req, res) => {
  const db = getDb()
  const file = requireFile(db, parseId(req.params.id))
  const { count, width } = frameParams(req, file)
  const index = Number(req.params.index)
  if (!Number.isInteger(index) || index < 0) throw new HttpError(400, 'Invalid frame index')
  sendJpeg(res, await getFrame(file, { index, count, width }))
}))

router.get('/files/:id/contact-sheet.jpg', wrap(async (req, res) => {
  const db = getDb()
  const file = requireFile(db, parseId(req.params.id))
  const count = clampInt(req.query.count, 9, 1, MAX_FRAMES)
  const cols = clampInt(req.query.cols, 3, 1, MAX_FRAMES)
  const { path: p, times, layout } = await getContactSheet(file, { count, cols })
  sendJpeg(res, p, {
    'X-Frame-Times': times.join(','),
    'X-Sheet-Layout': `${layout.cols}x${layout.rows}`,
  })
}))

router.get('/files/:id/thumbnail.jpg', (req, res) => {
  const file = requireFile(getDb(), parseId(req.params.id))
  if (!file.thumbnail_path || !existsSync(file.thumbnail_path)) throw new HttpError(404, 'No thumbnail')
  sendJpeg(res, file.thumbnail_path)
})

// ---- taxonomy creation (idempotent) -----------------------------------------

function logCreate(db, req, kind, detail) {
  logActivity(db, { agent: req.agent, action: `taxonomy.create_${kind}`, after: detail })
}

router.post('/categories', (req, res) => {
  const db = getDb()
  const { name, description = null, selection = 'multi' } = req.body || {}
  const n = typeof name === 'string' ? name.trim() : ''
  if (!n) throw new HttpError(400, 'name is required')
  if (!['single', 'multi'].includes(selection)) throw new HttpError(400, "selection must be 'single' or 'multi'")
  let cat = db.prepare('SELECT * FROM tag_categories WHERE name = ? COLLATE NOCASE').get(n)
  if (cat) return res.json({ created: false, category: cat })
  const id = db.prepare('INSERT INTO tag_categories (name, is_system, description, selection) VALUES (?, 0, ?, ?)')
    .run(n, description?.trim?.() || null, selection).lastInsertRowid
  cat = db.prepare('SELECT * FROM tag_categories WHERE id = ?').get(id)
  logCreate(db, req, 'category', { category: cat.name })
  res.status(201).json({ created: true, category: cat })
})

router.post('/tags', (req, res) => {
  const db = getDb()
  const { category_id, category, name, description = null, create_missing = false } = req.body || {}
  const n = typeof name === 'string' ? name.trim() : ''
  if (!n) throw new HttpError(400, 'name is required')
  if (category_id === undefined && !category) throw new HttpError(400, 'category_id or category is required')

  let cat = category_id !== undefined
    ? db.prepare('SELECT * FROM tag_categories WHERE id = ?').get(category_id)
    : db.prepare('SELECT * FROM tag_categories WHERE name = ? COLLATE NOCASE').get(String(category))
  if (!cat && category && create_missing) {
    const id = db.prepare('INSERT INTO tag_categories (name, is_system) VALUES (?, 0)').run(String(category).trim()).lastInsertRowid
    cat = db.prepare('SELECT * FROM tag_categories WHERE id = ?').get(id)
    logCreate(db, req, 'category', { category: cat.name })
  }
  if (!cat) throw new HttpError(404, 'Category not found (pass create_missing: true with a category name to create it)')
  if (cat.is_system) throw new HttpError(403, 'System categories cannot be changed by agents')

  let tag = db.prepare('SELECT * FROM tags WHERE category_id = ? AND name = ? COLLATE NOCASE').get(cat.id, n)
  if (tag) return res.json({ created: false, tag: { ...tag, category: cat.name } })
  const id = db.prepare('INSERT INTO tags (category_id, name, description) VALUES (?, ?, ?)')
    .run(cat.id, n, description?.trim?.() || null).lastInsertRowid
  tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id)
  logCreate(db, req, 'tag', { tag: `${cat.name}/${tag.name}` })
  res.status(201).json({ created: true, tag: { ...tag, category: cat.name } })
})

router.post('/folders', (req, res) => {
  const db = getDb()
  const { path: p, name, parent_id, parent_path } = req.body || {}
  let full = p
  if (full === undefined) {
    if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'path (or name) is required')
    let parent = ''
    if (parent_id !== undefined && parent_id !== null) {
      const pf = getFolder(db, parent_id)
      if (!pf) throw new HttpError(404, 'Parent folder not found')
      parent = getPathMap(db).get(pf.id)
    } else if (parent_path) parent = String(parent_path)
    full = parent ? `${parent}/${name}` : name
  }
  const { folder, created } = db.transaction(() => ensurePath(db, full))()
  const out = { created: created > 0, folder: { ...folder, path: getPathMap(db).get(folder.id) } }
  if (created) logCreate(db, req, 'folder', { folder: out.folder.path })
  res.status(created ? 201 : 200).json(out)
})

// ---- queue / leases ----------------------------------------------------------

// Claim a batch of files for processing. Leases are advisory and expire on their own.
router.post('/queue/claim', (req, res) => {
  const db = getDb()
  const { status = 'pending', owner } = req.body || {}
  if (!STATUSES.includes(status) || status === 'all') throw new HttpError(400, `status must be one of ${STATUSES.filter((s) => s !== 'all').join(', ')}`)
  const limit = clampInt(req.body?.limit, 10, 1, 100)
  const leaseSeconds = clampInt(req.body?.lease_seconds, 900, 30, 3600)
  const who = typeof owner === 'string' && owner.trim() ? owner.trim().slice(0, 80) : req.agent.name

  const now = new Date()
  const until = new Date(now.getTime() + leaseSeconds * 1000).toISOString()
  const { where, params } = buildFileFilter(db, { status })
  const rows = db.transaction(() => {
    const picked = db.prepare(`
      SELECT f.* FROM files f
      WHERE ${where} AND (f.lease_until IS NULL OR f.lease_until <= ?)
      ORDER BY f.id LIMIT ?
    `).all(...params, now.toISOString(), limit)
    const upd = db.prepare('UPDATE files SET lease_owner = ?, lease_until = ? WHERE id = ?')
    for (const f of picked) { upd.run(who, until, f.id); f.lease_owner = who; f.lease_until = until }
    return picked
  })()
  res.json({ owner: who, lease_until: rows.length ? until : null, lease_seconds: leaseSeconds, files: serializeFiles(db, rows) })
})

// Release leases held by this owner: { file_ids? (default: all), owner? }
router.post('/queue/release', (req, res) => {
  const db = getDb()
  const { file_ids, owner } = req.body || {}
  const who = typeof owner === 'string' && owner.trim() ? owner.trim() : req.agent.name
  let released
  if (file_ids === undefined) {
    released = db.prepare('UPDATE files SET lease_owner = NULL, lease_until = NULL WHERE lease_owner = ?').run(who).changes
  } else {
    if (!Array.isArray(file_ids) || !file_ids.every(Number.isInteger)) throw new HttpError(400, 'file_ids must be an array of integers')
    const stmt = db.prepare('UPDATE files SET lease_owner = NULL, lease_until = NULL WHERE id = ? AND lease_owner = ?')
    released = db.transaction(() => file_ids.reduce((n, id) => n + stmt.run(id, who).changes, 0))()
  }
  res.json({ released, owner: who })
})

// ---- activity ----------------------------------------------------------------

router.get('/activity', (req, res) => {
  const db = getDb()
  if (req.query.id) {
    const a = getActivity(db, parseId(req.query.id))
    if (!a) throw new HttpError(404, 'Not found')
    return res.json(a)
  }
  res.json(listActivity(db, req.query))
})

export default router
