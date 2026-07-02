import { Router } from 'express'
import { createReadStream, statSync, renameSync, existsSync } from 'fs'
import path from 'path'
import { getDb } from '../db/index.js'

const router = Router()

const SORT_COLUMNS = { date_added: 'f.date_added', filename: 'f.filename', duration: 'f.duration' }

// Shared WHERE-clause builder for the file list and the filter-aware "next file" lookup.
// Tag filtering is AND-across-categories, OR-within-category.
function buildFileFilter(db, { view = 'all', tags = '', search = '', favorites = '' }) {
  const tagIds = tags ? tags.split(',').map(Number).filter(Boolean) : []
  const tagConditions = []
  const tagParams = []

  if (tagIds.length > 0) {
    const tagRows = db.prepare(
      `SELECT t.id, t.category_id FROM tags t WHERE t.id IN (${tagIds.map(() => '?').join(',')})`
    ).all(...tagIds)

    const byCategory = {}
    for (const t of tagRows) {
      ;(byCategory[t.category_id] = byCategory[t.category_id] || []).push(t.id)
    }

    for (const catTagIds of Object.values(byCategory)) {
      tagConditions.push(
        `EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id AND ft.tag_id IN (${catTagIds.map(() => '?').join(',')}))`
      )
      tagParams.push(...catTagIds)
    }
  }

  const preParams = []
  if (search.trim()) {
    preParams.push(`%${search.trim()}%`)
  }

  const where = [
    'f.is_missing = 0',
    view === 'inbox' ? 'f.needs_tagging = 1' : null,
    favorites === '1' ? 'f.is_favorite = 1' : null,
    search.trim() ? 'f.filename LIKE ?' : null,
    ...tagConditions,
  ].filter(Boolean).join(' AND ')

  return { where, params: [...preParams, ...tagParams] }
}

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
  } = req.query

  const sortCol = SORT_COLUMNS[sort] || 'f.date_added'
  const sortDir = order === 'asc' ? 'ASC' : 'DESC'

  const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10))
  const limitVal = Math.max(1, parseInt(limit, 10))

  const { where, params: allParams } = buildFileFilter(db, { view, tags, search, favorites })

  const countSql = `SELECT COUNT(*) AS total FROM files f WHERE ${where}`
  const { total } = db.prepare(countSql).get(...allParams)

  const rows = db.prepare(`
    SELECT f.*,
      (SELECT GROUP_CONCAT(ft.tag_id) FROM file_tags ft WHERE ft.file_id = f.id) AS tag_ids
    FROM files f
    WHERE ${where}
    ORDER BY ${sortCol} ${sortDir}
    LIMIT ? OFFSET ?
  `).all(...allParams, limitVal, offset)

  // Attach full tag objects
  const fileIds = rows.map((r) => r.id)
  let tagsByFile = {}
  if (fileIds.length > 0) {
    const tagData = db.prepare(`
      SELECT ft.file_id, t.id, t.name, t.category_id, c.name AS category_name
      FROM file_tags ft
      JOIN tags t ON t.id = ft.tag_id
      JOIN tag_categories c ON c.id = t.category_id
      WHERE ft.file_id IN (${fileIds.map(() => '?').join(',')})
    `).all(...fileIds)

    for (const t of tagData) {
      ;(tagsByFile[t.file_id] = tagsByFile[t.file_id] || []).push({
        id: t.id, name: t.name, category_id: t.category_id, category_name: t.category_name,
      })
    }
  }

  const files = rows.map((r) => ({
    ...r,
    tag_ids: undefined,
    tags: tagsByFile[r.id] || [],
  }))

  res.json({ files, total, page: parseInt(page, 10), limit: limitVal })
})

router.get('/:id', (req, res) => {
  const db = getDb()
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id)
  if (!file) return res.status(404).json({ error: 'Not found' })

  const tags = db.prepare(`
    SELECT t.id, t.name, t.category_id, c.name AS category_name
    FROM file_tags ft
    JOIN tags t ON t.id = ft.tag_id
    JOIN tag_categories c ON c.id = t.category_id
    WHERE ft.file_id = ?
    ORDER BY c.name, t.name
  `).all(file.id)

  res.json({ ...file, tags })
})

// GET /api/files/:id/next — id of the next file in the current filtered/sorted view (wraps around)
router.get('/:id/next', (req, res) => {
  const db = getDb()
  const { tags = '', sort = 'date_added', order = 'desc', search = '', favorites = '' } = req.query

  const sortCol = SORT_COLUMNS[sort] || 'f.date_added'
  const sortDir = order === 'asc' ? 'ASC' : 'DESC'

  const { where, params } = buildFileFilter(db, { view: 'all', tags, search, favorites })

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

  if (is_favorite !== undefined) {
    db.prepare('UPDATE files SET is_favorite = ? WHERE id = ?').run(is_favorite ? 1 : 0, file.id)
  }

  if (notes !== undefined) {
    db.prepare('UPDATE files SET notes = ? WHERE id = ?').run(notes ?? null, file.id)
  }

  if (needs_tagging !== undefined) {
    db.prepare('UPDATE files SET needs_tagging = ? WHERE id = ?').run(needs_tagging ? 1 : 0, file.id)
  }

  if (Array.isArray(tag_ids)) {
    db.prepare('DELETE FROM file_tags WHERE file_id = ?').run(file.id)
    const insert = db.prepare('INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)')
    for (const tid of tag_ids) insert.run(file.id, tid)
  }

  const updated = db.prepare('SELECT * FROM files WHERE id = ?').get(file.id)
  const tags = db.prepare(`
    SELECT t.id, t.name, t.category_id, c.name AS category_name
    FROM file_tags ft
    JOIN tags t ON t.id = ft.tag_id
    JOIN tag_categories c ON c.id = t.category_id
    WHERE ft.file_id = ? ORDER BY c.name, t.name
  `).all(file.id)

  res.json({ ...updated, tags })
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
