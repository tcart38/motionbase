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
      const info = JSON.parse(await fs.readFile(full, 'utf8'))
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
