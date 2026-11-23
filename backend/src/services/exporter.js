// Data export: metadata (CSV / JSON) and the file layout of a full export. Everything is
// generator based and pages through the database, so large libraries never sit in memory.
// Only media files and metadata are ever exported: never the database, tokens, password
// hashes, sessions or cookies.txt.
import { promises as fs, createReadStream } from 'fs'
import { Readable, Transform } from 'stream'
import path from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'
import { config } from '../config.js'
import { getPathMap } from './folders.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const MOTIONBASE_VERSION = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).version

const PAGE = 500
const tick = () => new Promise((r) => setImmediate(r))

// Test seam: awaited before each file is copied/added.
export const hooks = { beforeFile: null }

export const FIXED_COLUMNS = [
  'id', 'filename', 'relative_path', 'folder_path', 'file_type', 'duration_seconds', 'width', 'height', 'fps',
  'aspect_ratio', 'file_size_bytes', 'date_added', 'uploaded_by', 'upload_source', 'favorite', 'reviewed',
  'reviewed_by', 'in_trash', 'notes', 'source_url', 'author', 'tags',
]

export const flag = (v) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase())

// ---- CSV ---------------------------------------------------------------------------

// RFC 4180 quoting plus a spreadsheet formula-injection guard: text cells that start with
// = + - @ (or a tab / CR) get a leading single quote so Excel/Sheets show them as text.
export function csvCell(v) {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const csvRow = (cells) => cells.map(csvCell).join(',') + '\r\n'

// ---- parsing notes written by the URL import -------------------------------------------

export function parseNotes(notes) {
  const out = { source_url: null, author: null }
  if (!notes) return out
  const src = /^Source:[ \t]*(.+?)[ \t]*$/im.exec(notes)
  if (src) out.source_url = src[1]
  const au = /^Author:[ \t]*(.+?)[ \t]*$/im.exec(notes)
  if (au) out.author = au[1].replace(/\s*\(https?:\/\/[^)]*\)\s*$/i, '').trim() || null
  return out
}

// ---- data ---------------------------------------------------------------------------

export function listCategories(db) {
  const cats = db.prepare('SELECT id, name, description, selection, is_system FROM tag_categories ORDER BY name COLLATE NOCASE, id').all()
  const tags = db.prepare('SELECT category_id, name, description FROM tags ORDER BY name COLLATE NOCASE, id').all()
  const by = new Map(cats.map((c) => [c.id, []]))
  for (const t of tags) by.get(t.category_id)?.push({ name: t.name, description: t.description ?? null })
  return cats.map((c) => ({
    name: c.name, description: c.description ?? null, selection: c.selection, is_system: !!c.is_system, tags: by.get(c.id),
  }))
}

export function listFolderPaths(db) {
  return [...getPathMap(db).values()].sort((a, b) => a.localeCompare(b))
}

const trashClause = (includeTrash) => (includeTrash ? '' : 'AND f.deleted_at IS NULL')

export function fileTotals(db, { includeTrash = false } = {}) {
  const r = db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(f.file_size), 0) AS bytes FROM files f WHERE f.is_missing = 0 ${trashClause(includeTrash)}`
  ).get()
  return { count: r.n, bytes: r.bytes }
}

export function relPath(filepath, mediaDir = config.mediaDir) {
  return path.relative(path.resolve(mediaDir), path.resolve(filepath)).split(path.sep).join('/')
}

function makeRecord(row, tags, history, pathMap, mediaDir) {
  const { source_url, author } = parseNotes(row.notes)
  const rec = {
    id: row.id,
    filename: row.filename,
    relative_path: relPath(row.filepath, mediaDir),
    folder_path: row.folder_id ? pathMap.get(row.folder_id) ?? '' : '',
    file_type: row.file_type,
    duration_seconds: row.duration ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    fps: row.fps ?? null,
    aspect_ratio: row.aspect_ratio ?? null,
    file_size_bytes: row.file_size ?? null,
    date_added: row.date_added,
    uploaded_by: row.uploader_name ?? row.uploader_username ?? null,
    upload_source: row.upload_source ?? null,
    favorite: !!row.is_favorite,
    reviewed: !!row.reviewed_at,
    reviewed_by: row.reviewed_by ?? null,
    reviewed_at: row.reviewed_at ?? null,
    in_trash: !!row.deleted_at,
    notes: row.notes ?? null,
    source_url,
    author,
    tags,
  }
  if (history) rec.history = history
  return rec
}

// Yields arrays of { row, rec } (<= 500 each), ordered by id (keyset paging, stable under writes).
export async function* filePages(db, { includeTrash = false, includeHistory = false, mediaDir = config.mediaDir } = {}) {
  const pathMap = getPathMap(db)
  const page = db.prepare(`
    SELECT f.*, u.display_name AS uploader_name, u.username AS uploader_username
    FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
    WHERE f.is_missing = 0 ${trashClause(includeTrash)} AND f.id > ? ORDER BY f.id LIMIT ?
  `)
  let after = 0
  for (;;) {
    const rows = page.all(after, PAGE)
    if (!rows.length) return
    after = rows.at(-1).id
    const ids = rows.map((r) => r.id)
    const ph = ids.map(() => '?').join(',')
    const tagsBy = new Map()
    for (const t of db.prepare(`
      SELECT ft.file_id, ft.source, t.name, c.name AS category
      FROM file_tags ft JOIN tags t ON t.id = ft.tag_id JOIN tag_categories c ON c.id = t.category_id
      WHERE ft.file_id IN (${ph}) ORDER BY c.name, t.name
    `).all(...ids)) {
      if (!tagsBy.has(t.file_id)) tagsBy.set(t.file_id, [])
      tagsBy.get(t.file_id).push({ category: t.category, name: t.name, source: t.source })
    }
    const histBy = new Map()
    if (includeHistory) {
      for (const e of db.prepare(`SELECT * FROM file_events WHERE file_id IN (${ph}) ORDER BY id`).all(...ids)) {
        if (!histBy.has(e.file_id)) histBy.set(e.file_id, [])
        histBy.get(e.file_id).push({
          action: e.action, actor: e.actor_label ?? null, created_at: e.created_at,
          detail: e.detail_json ? JSON.parse(e.detail_json) : null,
        })
      }
    }
    yield rows.map((row) => ({
      row,
      rec: makeRecord(row, tagsBy.get(row.id) || [], includeHistory ? histBy.get(row.id) || [] : null, pathMap, mediaDir),
    }))
    await tick()
  }
}

// ---- metadata streams ------------------------------------------------------------------

export function csvColumns(categories) {
  const fixed = new Set(FIXED_COLUMNS.map((c) => c.toLowerCase()))
  const cats = categories.filter((c) => !c.is_system).map((c) => ({
    name: c.name, header: fixed.has(c.name.toLowerCase()) ? `${c.name} (tags)` : c.name,
  }))
  return { cats, header: [...FIXED_COLUMNS, ...cats.map((c) => c.header)] }
}

// CSV with a UTF-8 BOM (Excel needs it for non-ASCII text) and CRLF line ends.
export async function* metadataCsv(db, opts = {}) {
  const { cats, header } = csvColumns(listCategories(db))
  yield '﻿' + csvRow(header)
  for await (const page of filePages(db, opts)) {
    let out = ''
    for (const { rec } of page) {
      const byCat = new Map()
      for (const t of rec.tags) {
        if (!byCat.has(t.category)) byCat.set(t.category, [])
        byCat.get(t.category).push(t.name)
      }
      const cells = FIXED_COLUMNS.map((c) => (c === 'tags' ? rec.tags.map((t) => `${t.category}: ${t.name}`).join('; ') : rec[c]))
      for (const c of cats) cells.push((byCat.get(c.name) || []).join('; '))
      out += csvRow(cells)
    }
    yield out
  }
}

export async function* metadataJson(db, opts = {}) {
  yield `{"exported_at":${JSON.stringify(new Date().toISOString())},"motionbase_version":${JSON.stringify(MOTIONBASE_VERSION)},`
  yield `"include_trash":${!!opts.includeTrash},"include_history":${!!opts.includeHistory},`
  yield `"categories":${JSON.stringify(listCategories(db))},"folders":${JSON.stringify(listFolderPaths(db))},"files":[`
  let first = true
  for await (const page of filePages(db, opts)) {
    yield page.map(({ rec }) => (first ? ((first = false), '') : ',') + JSON.stringify(rec)).join('')
  }
  yield ']}'
}

// ---- full export ----------------------------------------------------------------------

const safeSeg = (s) => {
  const t = String(s).replace(/[\x00-\x1f\\/]/g, '_')
  return t === '' || t === '.' || t === '..' ? '_' : t
}

// Allocates unique zip/folder entry names (case-insensitive, so it also works on Windows/macOS).
export function createNamer() {
  const used = new Set()
  return (folderPath, filename) => {
    const dir = ['videos', ...String(folderPath || '').split('/').filter(Boolean).map(safeSeg)].join('/')
    const base = safeSeg(filename)
    let name = `${dir}/${base}`
    if (used.has(name.toLowerCase())) {
      const ext = path.extname(base)
      const stem = ext ? base.slice(0, -ext.length) : base
      for (let i = 2; ; i++) {
        name = `${dir}/${stem} (${i})${ext}`
        if (!used.has(name.toLowerCase())) break
      }
    }
    used.add(name.toLowerCase())
    return name
  }
}

export function countingRead(file, signal, onBytes) {
  const rs = createReadStream(file, { signal })
  const counter = new Transform({
    transform(chunk, _enc, cb) { onBytes(chunk.length); cb(null, chunk) },
  })
  rs.on('error', (e) => counter.destroy(e))
  // After an abort the archive no longer listens; without this a late 'error' would be an uncaught exception
  // (it would crash the server when a client drops a download).
  counter.on('error', () => {})
  return rs.pipe(counter)
}

export function buildReadme({ mode, skipped, includeHistory, includeTrash, counters }) {
  const lines = [
    'MotionBase export',
    '=================',
    `Created:  ${new Date().toISOString()}`,
    `Version:  MotionBase ${MOTIONBASE_VERSION}`,
    `Mode:     ${mode === 'full' ? 'full (videos + metadata)' : 'metadata only'}`,
    `Trash:    ${includeTrash ? 'included' : 'excluded'}`,
    `History:  ${includeHistory ? 'included in metadata.json' : 'not included'}`,
    '',
    'Contents',
    '--------',
    ...(mode === 'full' ? ['videos/            your files, in the same folder hierarchy as MotionBase (collisions get " (2)" etc.)'] : []),
    'metadata.csv       one row per file, for spreadsheets (UTF-8 with BOM)',
    'metadata.json      everything MotionBase knows: tags, categories, folders, notes' + (includeHistory ? ', history' : ''),
    'README.txt         this file',
    '',
    'Restoring',
    '---------',
    '1. Copy the files from videos/ back into the MotionBase media directory (keep the folder layout:',
    '   metadata.json matches files by their path relative to the media directory, then by filename + size).',
    '2. Run a scan in MotionBase (or wait for the automatic scan).',
    '3. POST metadata.json to /api/import/metadata (dry run first with ?dry_run=1).',
    '',
  ]
  if (counters) lines.push(`Files exported: ${counters.files_done - skipped.length} of ${counters.files_total}`, '')
  if (skipped.length) {
    lines.push(`Skipped files (${skipped.length}) - these are in the metadata but not in videos/:`)
    for (const s of skipped.slice(0, 1000)) lines.push(`  ${s.relative_path}  (${s.reason})`)
    if (skipped.length > 1000) lines.push(`  ... and ${skipped.length - 1000} more`)
    lines.push('')
  }
  return lines.join('\n')
}

// Drives an export into a sink: { addFile(name, readable, {date}), addStream(name, readable), addText(name, text) }.
// counters is mutated as work progresses (files_done, bytes_done, files_skipped, skipped[]).
export async function runExport(db, sink, { mode = 'full', includeHistory = false, includeTrash = false, signal, counters = {} } = {}) {
  const mediaDir = config.mediaDir
  const c = counters
  c.files_done = 0; c.bytes_done = 0; c.files_skipped = 0; c.skipped = []
  const aborted = () => { if (signal?.aborted) throw Object.assign(new Error('Export cancelled'), { name: 'AbortError' }) }

  if (mode === 'full') {
    const name = createNamer()
    let realMedia
    try { realMedia = await fs.realpath(mediaDir) } catch { realMedia = path.resolve(mediaDir) }
    for await (const page of filePages(db, { includeTrash, includeHistory: false, mediaDir })) {
      for (const { row, rec } of page) {
        aborted()
        if (hooks.beforeFile) await hooks.beforeFile(row)
        aborted()
        const skip = (reason) => {
          c.skipped.push({ id: row.id, relative_path: rec.relative_path, reason })
          c.files_skipped++; c.files_done++; c.bytes_done += row.file_size || 0
        }
        let real = null
        try { real = await fs.realpath(row.filepath) } catch { /* missing */ }
        if (!real) { skip('missing on disk'); continue }
        const inside = path.relative(realMedia, real)
        if (inside.startsWith('..') || path.isAbsolute(inside)) { skip('outside the media directory'); continue }
        const st = await fs.stat(real).catch(() => null)
        if (!st?.isFile()) { skip('not a regular file'); continue }
        await sink.addFile(name(rec.folder_path, row.filename), countingRead(real, signal, (n) => { c.bytes_done += n }), { date: st.mtime })
        c.files_done++
      }
    }
  }

  aborted()
  await sink.addStream('metadata.csv', Readable.from(metadataCsv(db, { includeTrash })))
  await sink.addStream('metadata.json', Readable.from(metadataJson(db, { includeTrash, includeHistory })))
  if (mode !== 'full') c.files_done = c.files_total ?? 0
  await sink.addText('README.txt', buildReadme({ mode, skipped: c.skipped, includeHistory, includeTrash, counters: { files_done: c.files_done, files_total: c.files_total ?? c.files_done } }))
}
