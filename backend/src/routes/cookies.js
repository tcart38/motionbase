import { Router } from 'express'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import path from 'path'
import { config } from '../config.js'

const router = Router()

// Resolved on each call so DATA_DIR changes (tests) are respected.
export const getCookiesPath = () => path.join(config.dataDir, 'cookies.txt')

router.get('/', (req, res) => {
  res.json({ hasCookies: existsSync(getCookiesPath()) })
})

router.post('/', (req, res) => {
  const { content } = req.body
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'content is required' })
  }
  try {
    writeFileSync(getCookiesPath(), content, { encoding: 'utf8', mode: 0o600 })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/', (req, res) => {
  try {
    if (existsSync(getCookiesPath())) unlinkSync(getCookiesPath())
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
