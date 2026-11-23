import { Router } from 'express'
import { createReadStream, statSync, renameSync, existsSync } from 'fs'
import path from 'path'
import { getDb } from '../db/index.js'
import { SORT_COLUMNS, buildFileFilter, attachTags, getFileWithTags } from '../services/fileQuery.js'
import { applyFileUpdate } from '../services/fileMutations.js'

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
  } = req.query

  const sortCol = SORT_COLUMNS[sort] || 'f.date_added'
  const sortDir = order === 'asc' ? 'ASC' : 'DESC'

  const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10))
  const limitVal = Math.max(1, parseInt(limit, 10))

  const { where, params: allParams } = buildFileFilter(db, { view, tags, search, favorites, untagged })

  const countSql = `SELECT COUNT(*) AS total FROM files f WHERE ${where}`
  const { total } = db.prepare(countSql).get(...allParams)

  const rows = db.prepare(`
    SELECT f.* FROM files f
    WHERE ${where}
    ORDER BY ${sortCol} ${sortDir}
    LIMIT ? OFFSET ?
  `).all(...allParams, limitVal, offset)

  const files = attachTags(db, rows)

  res.json({ files, total, page: parseInt(page, 10), limit: limitVal })
})

router.get('/:id', (req, res) => {
  const file = getFileWithTags(getDb(), req.params.id)
  if (!file) return res.status(404).json({ error: 'Not found' })
  res.json(file)
})

// GET /api/files/:id/next — id of the next file in the current filtered/sorted view (wraps around)
router.get('/:id/next', (req, res) => {
  const db = getDb()
  const { tags = '', sort = 'date_added', order = 'desc', search = '', favorites = '', untagged = '' } = req.query

  const sortCol = SORT_COLUMNS[sort] || 'f.date_added'
  const sortDir = order === 'asc' ? 'ASC' : 'DESC'

  const { where, params } = buildFileFilter(db, { view: 'all', tags, search, favorites, untagged })

  const ids = db.prepare(`
    SELECT f.id FROM files f WHERE ${where} ORDER BY ${sortCol} ${sortDir}, f.id ${sortDir}
  `).all(...params).map((r) => r.id)

  if (ids.length === 0) return res.status(404).json({ error: 'No files match the current filter' })

  const currentIdx = ids.indexOf(Number(req.params.id))
  const nextId = currentIdx === -1 ? ids[0] : ids[(currentIdx + 1) % ids.length]

  res.json({ nextId, total: ids.length })
})

// PATCH /api/files/:id — update needs_tagging, tags, or filename
router.patch('/:id', (req, res) => {
  const db = getDb()
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id)
  if (!file) return res.status(404).json({ error: 'Not found' })

  const { needs_tagging, tag_ids, filename, is_favorite, notes } = req.body

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
    }
  }

  db.transaction(() => {
    applyFileUpdate(db, file, { needs_tagging, tag_ids, is_favorite, notes })
  })()

  res.json(getFileWithTags(db, file.id))
})

// DELETE /api/files/:id — permanently remove a missing file record
router.delete('/:id', (req, res) => {
  const db = getDb()
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id)
  if (!file) return res.status(404).json({ error: 'Not found' })
  db.prepare('DELETE FROM files WHERE id = ?').run(file.id)
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
