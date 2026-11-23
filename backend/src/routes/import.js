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
import { isLinkedInUrl, fetchPage, extractLinkedInPost, downloadLinkedInItems } from '../services/linkedinPost.js'

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

  res.setHeader('Content-Type', 'application/x-ndjson')
  res.setHeader('Cache-Control', 'no-cache')
  res.flushHeaders()

  const send = (obj) => res.write(JSON.stringify(obj) + '\n')
  const log = (line) => send({ type: 'log', line })

  // Files that appear in the media folder while downloading are attributed to this person.
  const by = actorFromReq(req)
  let before = new Set()
  try { before = new Set(await listMediaFiles()) } catch {}

  const finish = async () => {
    try {
      for (const f of await listMediaFiles()) if (!before.has(f)) claimUpload(f, { source: 'import', by, detail: { url } })
    } catch {}
    try { await runScan() } catch {}
  }

  // LinkedIn posts: read the page ourselves. yt-dlp only handles a post with exactly one video, so posts with
  // several videos / animated GIFs (or a short lnkd.in link) fail there.
  let target = url
  let page = null
  if (isLinkedInUrl(url)) {
    try {
      log('Reading the LinkedIn post…')
      const { finalUrl, html } = await fetchPage(url)
      page = { finalUrl, ...extractLinkedInPost(html) }
      target = finalUrl.split('#')[0]
      log(page.items.length ? `Found ${page.items.length} media item${page.items.length === 1 ? '' : 's'} in the post` : 'No media found on the page; trying the standard downloader')
    } catch (err) {
      log(`Could not read the post page (${err.message}); trying the standard downloader`)
    }
  }

  const direct = async () => {
    const files = await downloadLinkedInItems({
      items: page.items, post: page.post, finalUrl: page.finalUrl, mediaDir: config.mediaDir,
      tmpDir: path.join(config.dataDir, 'import-tmp'), send: log,
    })
    if (!files.length) { send({ type: 'error', message: 'No videos could be downloaded from this post' }); return res.end() }
    await finish()
    const db = getDb()
    for (const f of files) db.prepare("UPDATE files SET notes = ? WHERE filename = ? AND (notes IS NULL OR TRIM(notes) = '')").run(f.notes, f.filename)
    log(`Imported ${files.length} file${files.length === 1 ? '' : 's'} with author, description and link saved to Notes`)
    send({ type: 'done' })
    res.end()
  }

  const multi = page && (page.items.length > 1 || (page.items.length === 1 && page.items[0].kind === 'image'))
  if (multi) return direct()

  const proc = spawn('python3', buildYtdlpArgs(target))
  const handleOutput = (data) => {
    for (const line of data.toString().replace(ANSI_RE, '').split(/[\r\n]+/)) if (line.trim()) log(line.trim())
  }
  proc.stdout.on('data', handleOutput)
  proc.stderr.on('data', handleOutput)

  proc.on('close', async (code) => {
    if (code === 0) {
      await finish()
      try {
        const n = await applyImportMeta(getDb(), importMetaDir())
        if (n) log('Saved source details (author, description, link) to Notes')
      } catch {}
      send({ type: 'done' })
      return res.end()
    }
    if (page?.items.length) { log('The standard downloader failed; downloading directly from the post page'); return direct() }
    send({ type: 'error', message: 'Download failed — check the log above for details' })
    res.end()
  })
})

export default router
