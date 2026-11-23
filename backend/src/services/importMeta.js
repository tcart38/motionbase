import { promises as fs } from 'fs'
import path from 'path'

const clean = (v) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '')

function formatDate(info) {
  if (/^\d{8}$/.test(info.upload_date || '')) {
    const d = info.upload_date
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
  }
  if (Number.isFinite(info.timestamp)) return new Date(info.timestamp * 1000).toISOString().slice(0, 10)
  return ''
}

/**
 * Turn a yt-dlp info dict into plain-text notes: author, source, platform, post date, caption.
 * Only fields the site actually provided are included (LinkedIn posts expose author and a
 * caption snippet but not the post date). Returns '' when there is nothing useful.
 */
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const isLinkedIn = (info) => /(^|\.)linkedin\.com$/i.test(hostOf(info.webpage_url || info.original_url)) || info.extractor_key === 'LinkedIn'
function hostOf(u) { try { return new URL(u).hostname } catch { return '' } }

/** Pull the VideoObject / SocialMediaPosting JSON-LD out of a LinkedIn post page. */
export function parseLinkedInPage(html) {
  const out = {}
  const blocks = [...String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  for (const m of blocks) {
    let d
    try { d = JSON.parse(m[1]) } catch { continue }
    for (const node of Array.isArray(d) ? d : [d]) {
      if (!node || !['VideoObject', 'SocialMediaPosting', 'Article'].includes(node['@type'])) continue
      const who = node.creator || node.author
      const person = Array.isArray(who) ? who[0] : who
      if (person?.name) { out.uploader = person.name; if (person.url) out.uploader_url = person.url }
      if (node.uploadDate || node.datePublished) out.date = node.uploadDate || node.datePublished
      if (node.description || node.articleBody || node.headline) out.description = node.description || node.articleBody || node.headline
      return out
    }
  }
  return out
}

/** Last-resort author guess from LinkedIn page titles like "<caption> | <Author> | 31 comments" or "<Author> | <caption> | 21 likes | LinkedIn". */
export function authorFromLinkedInTitle(title) {
  if (!title) return ''
  const parts = String(title).split(' | ').map((x) => x.trim()).filter(Boolean)
  const hadSuffix = /^LinkedIn$/i.test(parts[parts.length - 1] || '')
  const core = parts.filter((x) => !/^LinkedIn$/i.test(x) && !/^\d[\d.,]*[KkMm]?\s+(likes?|comments?|reactions?)/i.test(x))
  if (core.length < 2) return ''
  return hadSuffix ? core[0] : core[core.length - 1]
}

/**
 * yt-dlp's LinkedIn extractor only reads JSON-LD of type SocialMediaPosting, but LinkedIn now serves a
 * VideoObject whose author is `creator`, so uploader and date come back empty and the description is a
 * truncated og:description. Fill those gaps from the page itself, then from the title.
 */
export async function enrichLinkedIn(info, fetchImpl = fetch) {
  if (!isLinkedIn(info)) return info
  const out = { ...info }
  const url = info.webpage_url || info.original_url
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(20000), redirect: 'follow' })
    if (res.ok) {
      const page = parseLinkedInPage(await res.text())
      if (!clean(out.uploader) && page.uploader) { out.uploader = page.uploader; if (!out.uploader_url && page.uploader_url) out.uploader_url = page.uploader_url }
      if (!out.upload_date && !Number.isFinite(out.timestamp) && page.date) {
        const t = Date.parse(page.date)
        if (!Number.isNaN(t)) out.timestamp = t / 1000
      }
      // The page's description is the full caption; og:description is a snippet ending in "… on LinkedIn".
      if (page.description && (!clean(out.description) || page.description.length >= clean(out.description).length || /on LinkedIn$/.test(clean(out.description)))) {
        out.description = page.description
      }
    }
  } catch { /* offline / blocked: fall through to the title */ }
  if (!clean(out.uploader)) {
    const guess = authorFromLinkedInTitle(out.title)
    if (guess) out.uploader = guess
  }
  return out
}

export function buildNotesFromInfo(info = {}) {
  const author = clean(info.uploader) || clean(info.channel) || clean(info.creator) || clean(info.uploader_id)
  const authorUrl = clean(info.uploader_url) || clean(info.channel_url)
  const source = clean(info.webpage_url) || clean(info.original_url)
  const platform = clean(info.extractor_key)
  const date = formatDate(info)
  const description = clean(info.description)
  const title = clean(info.title)

  const lines = []
  if (author) lines.push(`Author: ${author}${authorUrl ? ` (${authorUrl})` : ''}`)
  if (source) lines.push(`Source: ${source}`)
  if (platform && platform.toLowerCase() !== 'generic') lines.push(`Platform: ${platform}`)
  if (date) lines.push(`Posted: ${date}`)
  if (!description && title) lines.push(`Title: ${title}`)
  let out = lines.join('\n')
  if (description) out += `${out ? '\n\n' : ''}${description}`
  return out
}

/**
 * Read the .info.json files yt-dlp wrote to `metaDir`, copy them into the `notes` of the matching
 * file (named "[<id>] ..." in the media folder) when that file has no notes yet, then delete them.
 * Never overwrites existing notes. Returns the number of files updated.
 */
export async function applyImportMeta(db, metaDir) {
  let updated = 0
  let names = []
  try { names = (await fs.readdir(metaDir)).filter((n) => n.endsWith('.info.json')) } catch { return 0 }
  for (const name of names) {
    const full = path.join(metaDir, name)
    try {
      const info = await enrichLinkedIn(JSON.parse(await fs.readFile(full, 'utf8')))
      const notes = buildNotesFromInfo(info)
      if (notes && info.id != null) {
        const r = db.prepare(
          `UPDATE files SET notes = ? WHERE (notes IS NULL OR TRIM(notes) = '') AND substr(filename, 1, ?) = ?`
        ).run(notes, String(info.id).length + 3, `[${info.id}] `)
        updated += r.changes
      }
    } catch { /* unreadable info json: skip */ }
    await fs.rm(full, { force: true })
  }
  return updated
}
