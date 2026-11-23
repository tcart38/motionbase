import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import { existsSync } from 'fs'
import { config } from '../config.js'
import { runScan, claimUpload } from '../services/scanner.js'
import { getDb } from '../db/index.js'
import { actorFromReq } from '../services/history.js'

const ALLOWED_MIMES = new Set([
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska',
  'video/webm', 'video/x-m4v', 'video/x-ms-wmv', 'video/x-flv', 'video/mxf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff',
])

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.mediaDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[/\\:*?"<>|]/g, '_')
    const ext = path.extname(safe)
    const base = path.basename(safe, ext)
    let name = safe
    let i = 1
    while (existsSync(path.join(config.mediaDir, name))) {
      name = `${base} (${i++})${ext}`
    }
    cb(null, name)
  },
})

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => cb(null, ALLOWED_MIMES.has(file.mimetype)),
})

const router = Router()

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No valid file received' })
  claimUpload(req.file.path, { source: 'user', by: actorFromReq(req), detail: { original_name: req.file.originalname } })
  try { await runScan() } catch {}
  const row = getDb().prepare('SELECT id FROM files WHERE filepath = ?').get(path.normalize(req.file.path))
  res.json({ ok: true, filename: req.file.filename, file_id: row?.id ?? null })
})

export default router
