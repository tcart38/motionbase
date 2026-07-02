import { promises as fs } from 'fs'
import path from 'path'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { probeVideo, probeImage, generateThumbnail } from './ffprobe.js'

const VIDEO_EXT = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wmv', '.flv', '.mxf'])
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'])

let isScanning = false
let lastScanResult = null

export function getScanState() {
  return { isScanning, lastScanResult }
}

export async function runScan() {
  if (isScanning) return { skipped: true, reason: 'Scan already in progress' }

  isScanning = true
  const result = { added: 0, missing: 0, errors: [] }

  try {
    await fs.mkdir(config.thumbnailsDir, { recursive: true })

    const db = getDb()

    const dbFiles = db.prepare('SELECT id, filepath FROM files WHERE is_missing = 0').all()
    const dbMap = new Map(dbFiles.map((f) => [f.filepath, f.id]))

    const diskFiles = await walkDirectory(config.mediaDir)
    const diskSet = new Set(diskFiles.map((f) => f.filepath))

    // Mark disappeared files as missing
    for (const [filepath, id] of dbMap) {
      if (!diskSet.has(filepath)) {
        db.prepare('UPDATE files SET is_missing = 1 WHERE id = ?').run(id)
        result.missing++
      }
    }

    // Process new files
    for (const fileInfo of diskFiles) {
      if (dbMap.has(fileInfo.filepath)) continue
      try {
        await processFile(db, fileInfo)
        result.added++
      } catch (err) {
        result.errors.push({ file: fileInfo.filename, error: err.message })
      }
    }

    // Backfill file_size for rows that predate the column (or whose stat failed before)
    const missingSize = db.prepare('SELECT id, filepath FROM files WHERE file_size IS NULL AND is_missing = 0').all()
    for (const row of missingSize) {
      try {
        const stat = await fs.stat(row.filepath)
        db.prepare('UPDATE files SET file_size = ? WHERE id = ?').run(stat.size, row.id)
      } catch { /* leave null; will retry next scan */ }
    }

    lastScanResult = { ...result, scannedAt: new Date().toISOString() }
    return result
  } finally {
    isScanning = false
  }
}

async function walkDirectory(dir) {
  const results = []

  async function recurse(current) {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await recurse(full)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (VIDEO_EXT.has(ext)) results.push({ filepath: full, filename: entry.name, file_type: 'video' })
        else if (IMAGE_EXT.has(ext)) results.push({ filepath: full, filename: entry.name, file_type: 'image' })
      }
    }
  }

  await recurse(dir)
  return results
}

async function processFile(db, fileInfo) {
  // Insert stub row to get the ID
  const { lastInsertRowid: id } = db.prepare(
    `INSERT INTO files (filepath, filename, file_type) VALUES (?, ?, ?)`
  ).run(fileInfo.filepath, fileInfo.filename, fileInfo.file_type)

  let meta = {}
  try {
    meta = fileInfo.file_type === 'video'
      ? await probeVideo(fileInfo.filepath)
      : await probeImage(fileInfo.filepath)
  } catch { /* leave nulls */ }

  let fileSize = null
  try {
    fileSize = (await fs.stat(fileInfo.filepath)).size
  } catch { /* leave null */ }

  let thumbnailPath = null
  try {
    const outPath = path.join(config.thumbnailsDir, `${id}.jpg`)
    await generateThumbnail(fileInfo.filepath, fileInfo.file_type, outPath, meta.duration)
    thumbnailPath = outPath
  } catch { /* leave null */ }

  const aspectRatio = detectAspectRatio(meta.width, meta.height)

  db.prepare(`
    UPDATE files
    SET duration = ?, width = ?, height = ?, fps = ?,
        aspect_ratio = ?, thumbnail_path = ?, file_size = ?
    WHERE id = ?
  `).run(meta.duration ?? null, meta.width ?? null, meta.height ?? null,
         meta.fps ?? null, aspectRatio, thumbnailPath, fileSize, id)

  if (aspectRatio) applyAspectRatioTag(db, id, aspectRatio)
}

function detectAspectRatio(w, h) {
  if (!w || !h) return null
  const r = w / h
  const buckets = [
    { name: '16:9', r: 16 / 9 },
    { name: '1:1', r: 1 },
    { name: '4:5', r: 4 / 5 },
    { name: '9:16', r: 9 / 16 },
  ]
  return buckets.reduce((best, b) =>
    Math.abs(r - b.r) < Math.abs(r - best.r) ? b : best
  ).name
}

function applyAspectRatioTag(db, fileId, ratioName) {
  const cat = db.prepare("SELECT id FROM tag_categories WHERE name = 'Aspect Ratio'").get()
  if (!cat) return
  const tag = db.prepare('SELECT id FROM tags WHERE category_id = ? AND name = ?').get(cat.id, ratioName)
  if (!tag) return
  db.prepare('INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)').run(fileId, tag.id)
}
