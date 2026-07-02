import { Router } from 'express'
import { getDb } from '../db/index.js'

const router = Router()

router.get('/', (req, res) => {
  const db = getDb()
  const categories = db.prepare(`
    SELECT c.*, COUNT(t.id) AS tag_count
    FROM tag_categories c
    LEFT JOIN tags t ON t.category_id = c.id
    GROUP BY c.id
    ORDER BY c.name
  `).all()
  res.json(categories)
})

router.post('/', (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

  const db = getDb()
  try {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO tag_categories (name, is_system) VALUES (?, 0)'
    ).run(name.trim())
    res.status(201).json(db.prepare('SELECT * FROM tag_categories WHERE id = ?').get(lastInsertRowid))
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Category name already exists' })
    throw err
  }
})

router.patch('/:id', (req, res) => {
  const db = getDb()
  const cat = db.prepare('SELECT * FROM tag_categories WHERE id = ?').get(req.params.id)
  if (!cat) return res.status(404).json({ error: 'Not found' })

  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

  try {
    db.prepare('UPDATE tag_categories SET name = ? WHERE id = ?').run(name.trim(), cat.id)
    res.json(db.prepare('SELECT * FROM tag_categories WHERE id = ?').get(cat.id))
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Category name already exists' })
    throw err
  }
})

router.delete('/:id', (req, res) => {
  const db = getDb()
  const cat = db.prepare('SELECT * FROM tag_categories WHERE id = ?').get(req.params.id)
  if (!cat) return res.status(404).json({ error: 'Not found' })
  if (cat.is_system) return res.status(403).json({ error: 'Cannot delete a system category' })

  // Count affected files
  const { affected } = db.prepare(`
    SELECT COUNT(DISTINCT ft.file_id) AS affected
    FROM file_tags ft
    JOIN tags t ON t.id = ft.tag_id
    WHERE t.category_id = ?
  `).get(cat.id)

  db.prepare('DELETE FROM tag_categories WHERE id = ?').run(cat.id)
  res.json({ deleted: true, affectedFiles: affected })
})

// Expose affected file count before deletion (used by confirmation dialog)
router.get('/:id/delete-preview', (req, res) => {
  const db = getDb()
  const cat = db.prepare('SELECT * FROM tag_categories WHERE id = ?').get(req.params.id)
  if (!cat) return res.status(404).json({ error: 'Not found' })

  const { affected } = db.prepare(`
    SELECT COUNT(DISTINCT ft.file_id) AS affected
    FROM file_tags ft
    JOIN tags t ON t.id = ft.tag_id
    WHERE t.category_id = ?
  `).get(cat.id)

  res.json({ category: cat, affectedFiles: affected })
})

export default router
