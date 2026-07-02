import { Router } from 'express'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import path from 'path'
import { config } from '../config.js'

const router = Router()

export const cookiesPath = path.join(config.dataDir, 'cookies.txt')

router.get('/', (req, res) => {
  res.json({ hasCookies: existsSync(cookiesPath) })
})

router.post('/', (req, res) => {
  const { content } = req.body
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'content is required' })
  }
  try {
    writeFileSync(cookiesPath, content, 'utf8')
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/', (req, res) => {
  try {
    if (existsSync(cookiesPath)) unlinkSync(cookiesPath)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
