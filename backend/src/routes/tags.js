import { Router } from 'express'
import { getDb } from '../db/index.js'

const router = Router()

// GET /api/tags — all tags with category info
router.get('/', (req, res) => {
  const db = getDb()
  const tags = db.prepare(`
    SELECT t.*, c.name AS category_name, c.is_system AS category_is_system
    FROM tags t
    JOIN tag_categories c ON c.id = t.category_id
    ORDER BY c.name, t.name
  `).all()
  res.json(tags)
})

// POST /api/tags
router.post('/', (req, res) => {
  const { category_id, name } = req.body
  if (!category_id || !name?.trim()) {
    return res.status(400).json({ error: 'category_id and name are required' })
  }

  const db = getDb()
  const cat = db.prepare('SELECT id FROM tag_categories WHERE id = ?').get(category_id)
  if (!cat) return res.status(404).json({ error: 'Category not found' })

  try {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO tags (category_id, name) VALUES (?, ?)'
    ).run(category_id, name.trim())
    res.status(201).json(db.prepare(`
      SELECT t.*, c.name AS category_name FROM tags t
      JOIN tag_categories c ON c.id = t.category_id WHERE t.id = ?
    `).get(lastInsertRowid))
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Tag already exists in this category' })
    throw err
  }
})

router.patch('/:id', (req, res) => {
  const db = getDb()
  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id)
  if (!tag) return res.status(404).json({ error: 'Not found' })

  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

  try {
    db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name.trim(), tag.id)
    res.json(db.prepare(`
      SELECT t.*, c.name AS category_name FROM tags t
      JOIN tag_categories c ON c.id = t.category_id WHERE t.id = ?
    `).get(tag.id))
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Tag already exists in this category' })
    throw err
  }
})

router.get('/:id/delete-preview', (req, res) => {
  const db = getDb()
  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id)
  if (!tag) return res.status(404).json({ error: 'Not found' })

  const { affected } = db.prepare(
    'SELECT COUNT(*) AS affected FROM file_tags WHERE tag_id = ?'
  ).get(tag.id)

  res.json({ tag, affectedFiles: affected })
})

router.delete('/:id', (req, res) => {
  const db = getDb()
  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id)
  if (!tag) return res.status(404).json({ error: 'Not found' })

  const { affected } = db.prepare(
    'SELECT COUNT(*) AS affected FROM file_tags WHERE tag_id = ?'
  ).get(tag.id)

  db.prepare('DELETE FROM tags WHERE id = ?').run(tag.id)
  res.json({ deleted: true, affectedFiles: affected })
})

export default router
