import { Router } from 'express'
import { spawn } from 'child_process'
import { config } from '../config.js'
import { existsSync, mkdirSync } from 'fs'
import path from 'path'
import { getDb } from '../db/index.js'
import { applyImportMeta } from '../services/importMeta.js'
import { runScan, claimUpload, listMediaFiles } from '../services/scanner.js'
import { actorFromReq } from '../services/history.js'
import { getCookiesPath } from './cookies.js'

const router = Router()

const ANSI_RE = /\x1b\[[0-9;]*m/g

// Arguments for `python3 ...`. Passes the uploaded cookies file (Settings > General) when present.
export function importMetaDir() { return path.join(config.dataDir, 'import-meta') }

export function buildYtdlpArgs(url) {
  const outputTemplate = `${config.mediaDir}/[%(id)s] %(title)s.%(ext)s`
  const cookies = getCookiesPath()
  return [
    '-m', 'yt_dlp',
    '--output', outputTemplate,
    // Save post metadata (author, caption, date...) into DATA_DIR (not the media folder), then folded into Notes.
    '--write-info-json',
    '--output', `infojson:${importMetaDir()}/%(id)s`,
    '--trim-filenames', '150',
    '--format', 'bestvideo+bestaudio/best',
    '--merge-output-format', 'mp4',
    '--no-playlist',
    ...(existsSync(cookies) ? ['--cookies', cookies] : []),
    url,
  ]
}

router.post('/', async (req, res) => {
  const { url } = req.body
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'A valid http/https URL is required' })
  }

  try { mkdirSync(importMetaDir(), { recursive: true }) } catch {}
  const args = buildYtdlpArgs(url)

  res.setHeader('Content-Type', 'application/x-ndjson')
  res.setHeader('Cache-Control', 'no-cache')
  res.flushHeaders()

  const send = (obj) => res.write(JSON.stringify(obj) + '\n')

  // Files that appear in the media folder while yt-dlp runs are attributed to this person.
  const by = actorFromReq(req)
  let before = new Set()
  try { before = new Set(await listMediaFiles()) } catch {}

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
      try {
        for (const f of await listMediaFiles()) if (!before.has(f)) claimUpload(f, { source: 'import', by, detail: { url } })
      } catch {}
      try { await runScan() } catch {}
      try {
        const n = await applyImportMeta(getDb(), importMetaDir())
        if (n) send({ type: 'log', line: 'Saved source details (author, description, link) to Notes' })
      } catch {}
      send({ type: 'done' })
    } else {
      send({ type: 'error', message: 'Download failed — check the log above for details' })
    }
    res.end()
  })
})

export default router
