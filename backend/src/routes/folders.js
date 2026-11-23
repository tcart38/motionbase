import { Router } from 'express'
import path from 'path'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { HttpError } from '../services/errors.js'
import {
  getTree, getFolder, createFolder, renameFolder, moveFolder, deleteFolder, ensurePath,
} from '../services/folders.js'

const router = Router()

// GET /api/folders -> { folders: [{id,parent_id,name,position,file_count,total_count}], all_count, unfiled_count }
router.get('/', (req, res) => {
  res.json(getTree(getDb()))
})

router.post('/', (req, res) => {
  const { name, parent_id = null } = req.body
  res.status(201).json(createFolder(getDb(), { name, parentId: parent_id }))
})

router.patch('/:id', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  const { name, parent_id, position } = req.body
  db.transaction(() => {
    if (!getFolder(db, id)) throw new HttpError(404, 'Not found')
    if (name !== undefined) renameFolder(db, id, name)
    if (parent_id !== undefined || position !== undefined) moveFolder(db, id, parent_id, position)
  })()
  res.json(getFolder(db, id))
})

router.delete('/:id', (req, res) => {
  const db = getDb()
  res.json(db.transaction(() => deleteFolder(db, Number(req.params.id)))())
})

// POST /api/folders/import-from-disk { dry_run? }
// Mirrors the on-disk sub-directory structure of MEDIA_DIR into virtual folders and
// files still unfiled. Already-filed files are left alone.
router.post('/import-from-disk', (req, res) => {
  const db = getDb()
  const dryRun = !!req.body?.dry_run
  const mediaDir = path.resolve(config.mediaDir)
  const result = { folders_created: 0, files_assigned: 0, dry_run: dryRun }

  const rollback = new Error('rollback')
  try {
    db.transaction(() => {
      const files = db.prepare(
        'SELECT id, filepath FROM files WHERE is_missing = 0 AND deleted_at IS NULL AND folder_id IS NULL'
      ).all()
      for (const f of files) {
        const rel = path.relative(mediaDir, path.dirname(f.filepath))
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue
        const { folder, created } = ensurePath(db, rel.split(path.sep).join('/'))
        result.folders_created += created
        db.prepare('UPDATE files SET folder_id = ? WHERE id = ?').run(folder.id, f.id)
        result.files_assigned++
      }
      if (dryRun) throw rollback
    })()
  } catch (err) {
    if (err !== rollback) throw err
  }
  res.json(result)
})

export default router
