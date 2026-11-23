import { createWriteStream, promises as fs } from 'fs'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { spawn } from 'child_process'
import path from 'path'
import { buildNotesFromInfo } from './importMeta.js'

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const MAX_BYTES = 600 * 1024 * 1024

export function isLinkedInUrl(url) {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h === 'lnkd.in' || h === 'linkedin.com' || h.endsWith('.linkedin.com')
  } catch { return false }
}

const unescapeHtml = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : [])
const urlKey = (u) => { try { const x = new URL(u); return x.origin + x.pathname } catch { return u } }

/**
 * Everything downloadable in a LinkedIn post page, in page order, plus the post's details.
 * yt-dlp's LinkedIn extractor only understands a post with exactly one <video>, so posts with
 * several videos or animated GIFs fail ("Unable to extract video"). The logged-out page exposes
 * them as <video data-sources> tags and as JSON-LD (VideoObject.contentUrl / SocialMediaPosting.image).
 * Returns { items: [{ url, kind: 'video'|'image' }], post: { author, author_url, date, description, source, postId } }.
 */
export function extractLinkedInPost(html) {
  const items = []
  const seen = new Set()
  const add = (url, kind) => {
    if (!url || !/^https?:\/\//i.test(url)) return
    const k = urlKey(url)
    if (seen.has(k)) return
    seen.add(k)
    items.push({ url, kind })
  }
  const post = {}

  for (const m of String(html).matchAll(/<video\b[^>]*>/gi)) {
    const tag = m[0]
    const ds = /data-sources="([^"]*)"/i.exec(tag)
    if (ds) {
      try {
        const sources = JSON.parse(unescapeHtml(ds[1]))
        const best = asArray(sources).find((s) => /mp4/i.test(s.type || '') || /\.mp4/i.test(s.src || '')) || asArray(sources)[0]
        if (best?.src) add(unescapeHtml(best.src), 'video')
      } catch { /* ignore */ }
    }
    const src = /\ssrc="([^"]+)"/i.exec(tag)
    if (src) add(unescapeHtml(src[1]), 'video')
  }

  const nodes = []
  for (const m of String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { for (const n of asArray(JSON.parse(m[1]))) nodes.push(...(n['@graph'] ? asArray(n['@graph']) : [n])) } catch { /* ignore */ }
  }
  for (const n of nodes) {
    if (!['VideoObject', 'SocialMediaPosting', 'Article'].includes(n?.['@type'])) continue
    const who = asArray(n.creator || n.author)[0]
    if (who?.name && !post.author) { post.author = who.name; if (who.url) post.author_url = who.url }
    if (!post.date && (n.uploadDate || n.datePublished)) post.date = n.uploadDate || n.datePublished
    if (!post.description && (n.articleBody || n.description || n.headline)) post.description = n.articleBody || n.description || n.headline
    if (!post.source && typeof n['@id'] === 'string' && /^https?:/.test(n['@id'])) post.source = n['@id']
    if (n.contentUrl) add(n.contentUrl, 'video')
    for (const v of asArray(n.video)) add(v?.contentUrl || v?.url, 'video')
  }
  for (const n of nodes) {
    if (n?.['@type'] !== 'SocialMediaPosting' && n?.['@type'] !== 'Article') continue
    for (const im of asArray(n.image)) add(typeof im === 'string' ? im : im?.url, 'image')
  }

  const og = /property="og:url"\s+content="([^"]+)"/i.exec(html)
  if (!post.source && og) post.source = unescapeHtml(og[1])
  const idm = /(?:activity|ugcPost|share)[-:](\d{10,})/.exec(post.source || '') || /urn:li:(?:activity|ugcPost|share):(\d{10,})/.exec(html)
  post.postId = idm ? idm[1] : null
  return { items, post }
}

const safeName = (s, max = 80) => String(s || '')
  .replace(/https?:\/\/\S+/g, '').replace(/#\S+/g, '').replace(/[\\/:*?"<>|%\x00-\x1f]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max).trim()

export function buildItemNotes(post, finalUrl, n, total) {
  const ts = Date.parse(post.date || '')
  const base = buildNotesFromInfo({
    uploader: post.author, uploader_url: post.author_url, webpage_url: post.source || finalUrl,
    extractor_key: 'LinkedIn', timestamp: Number.isNaN(ts) ? undefined : ts / 1000, description: post.description,
  })
  return total > 1 ? `${base}${base ? '\n\n' : ''}Item ${n} of ${total} in this post` : base
}

export async function fetchPage(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, redirect: 'follow', signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`LinkedIn returned ${res.status}`)
  return { finalUrl: res.url || url, html: await res.text() }
}

function convertGifToMp4(src, dest) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-y', '-v', 'error', '-i', src, '-movflags', '+faststart', '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-an', dest])
    let err = ''
    p.stderr.on('data', (d) => { err += d })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exited ${code}`))))
  })
}

/**
 * Download every video / animated GIF of a LinkedIn post into mediaDir. GIFs become MP4 so they get a
 * thumbnail, duration and frame stepping like any other clip (the GIF is kept if ffmpeg is unavailable).
 * Still images are skipped. Returns [{ filename, notes }] for the files written.
 */
export async function downloadLinkedInItems({ items, post, finalUrl, mediaDir, tmpDir, send = () => {}, fetchImpl = fetch, convert = convertGifToMp4 }) {
  await fs.mkdir(tmpDir, { recursive: true })
  const total = items.length
  const label = safeName(post.description, 70) || (post.author ? `LinkedIn post by ${safeName(post.author, 40)}` : 'LinkedIn post')
  const idPart = post.postId || String(Date.now())
  const out = []
  let skipped = 0
  for (let i = 0; i < items.length; i++) {
    const n = i + 1
    const tmp = path.join(tmpDir, `${idPart}-${n}.part`)
    try {
      send(`Downloading item ${n} of ${total}…`)
      const res = await fetchImpl(items[i].url, { headers: { 'User-Agent': UA, Referer: 'https://www.linkedin.com/' }, redirect: 'follow', signal: AbortSignal.timeout(180000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      const isGif = type === 'image/gif'
      const isVideo = type.startsWith('video/') || type === 'application/octet-stream' && items[i].kind === 'video'
      if (!isGif && !isVideo) { skipped++; send(`Skipped item ${n} (a still image)`); continue }
      const len = Number(res.headers.get('content-length') || 0)
      if (len > MAX_BYTES) throw new Error('file is larger than 600 MB')
      await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))

      const stem = `[${idPart}${total > 1 ? `-${n}` : ''}] ${label}${total > 1 ? ` (${n} of ${total})` : ''}`
      let ext = isGif ? '.gif' : '.mp4'
      let finalName = stem + ext
      if (isGif) {
        try {
          const mp4 = tmp + '.mp4'
          await convert(tmp, mp4)
          await fs.rm(tmp, { force: true })
          await fs.rename(mp4, tmp)
          ext = '.mp4'; finalName = stem + ext
        } catch (err) {
          send(`Could not convert item ${n} to MP4 (${err.message}); keeping the GIF`)
        }
      }
      await fs.rename(tmp, path.join(mediaDir, finalName)).catch(async () => {
        await fs.copyFile(tmp, path.join(mediaDir, finalName)); await fs.rm(tmp, { force: true })
      })
      out.push({ filename: finalName, notes: buildItemNotes(post, finalUrl, n, total) })
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      send(`Item ${n} failed: ${err.message}`)
    }
  }
  if (skipped) send(`${skipped} still image${skipped === 1 ? '' : 's'} skipped (MotionBase imports videos and animated GIFs)`)
  return out
}
