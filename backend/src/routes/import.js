import { Router } from 'express'
import { spawn } from 'child_process'
import { config } from '../config.js'
import { runScan } from '../services/scanner.js'

const router = Router()

const ANSI_RE = /\x1b\[[0-9;]*m/g

router.post('/', async (req, res) => {
  const { url } = req.body
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A valid http/https URL is required' })
  }

  const outputTemplate = `${config.mediaDir}/%(title)s [%(id)s].%(ext)s`
  const args = [
    '-m', 'yt_dlp',
    '--output', outputTemplate,
    '--format', 'bestvideo+bestaudio/best',
    '--merge-output-format', 'mp4',
    '--no-playlist',
    url,
  ]

  res.setHeader('Content-Type', 'application/x-ndjson')
  res.setHeader('Cache-Control', 'no-cache')
  res.flushHeaders()

  const send = (obj) => res.write(JSON.stringify(obj) + '\n')

  const proc = spawn('python3', args)

  const handleOutput = (data) => {
    const lines = data.toString().replace(ANSI_RE, '').split(/[\r\n]+/)
    for (const line of lines) {
      if (line.trim()) send({ type: 'log', line: line.trim() })
    }
  }

  proc.stdout.on('data', handleOutput)
  proc.stderr.on('data', handleOutput)

  proc.on('close', async (code) => {
    if (code === 0) {
      try { await runScan() } catch {}
      send({ type: 'done' })
    } else {
      send({ type: 'error', message: 'Download failed — check the log above for details' })
    }
    res.end()
  })
})

export default router
