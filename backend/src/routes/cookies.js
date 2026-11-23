import { Router } from 'express'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import path from 'path'
import { config } from '../config.js'
import { requireAdmin } from '../middleware/session.js'
import { audit, userActor } from '../services/auth.js'
import { getDb } from '../db/index.js'

const router = Router()

// Resolved on each call so DATA_DIR changes (tests) are respected.
export const getCookiesPath = () => path.join(config.dataDir, 'cookies.txt')

router.get('/', (req, res) => {
  res.json({ hasCookies: existsSync(getCookiesPath()) })
})

router.post('/', requireAdmin, (req, res) => {
  const { content } = req.body
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'content is required' })
  }
  try {
    writeFileSync(getCookiesPath(), content, { encoding: 'utf8', mode: 0o600 })
    audit(getDb(), userActor(req.user), 'settings_changed', { cookies: 'uploaded' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/', requireAdmin, (req, res) => {
  try {
    if (existsSync(getCookiesPath())) unlinkSync(getCookiesPath())
    audit(getDb(), userActor(req.user), 'settings_changed', { cookies: 'removed' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
