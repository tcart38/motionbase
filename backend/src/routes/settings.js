import { Router } from 'express'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDb } from '../db/index.js'
import { reschedule } from '../services/scheduler.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8'))

const router = Router()

router.get('/', (req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  res.json({ ...settings, version })
})

router.put('/', (req, res) => {
  const db = getDb()
  const { scan_interval } = req.body

  if (scan_interval !== undefined) {
    const val = parseInt(scan_interval, 10)
    if (isNaN(val) || val < 0) return res.status(400).json({ error: 'Invalid scan_interval' })
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('scan_interval', ?)").run(String(val))
    reschedule()
  }

  const rows = db.prepare('SELECT key, value FROM settings').all()
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])))
})

export default router
