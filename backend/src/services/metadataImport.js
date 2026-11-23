// Restore tags, folders, notes, favorites and review state from an exported metadata.json.
// Files are matched to rows that already exist in the library (relative path first, then
// filename + size); nothing on disk is read or written, and unmatched entries are only reported.
import path from 'path'
import { config } from '../config.js'
import { HttpError } from './errors.js'
import { ensurePath } from './folders.js'
import { recordEvent } from './history.js'
import { createGroup } from './groups.js'

class DryRun extends Error {}

const str = (v) => (typeof v === 'string' ? v : null)
const cleanName = (v) => (typeof v === 'string' ? v.trim() : '')

function parseTag(t) {
  if (typeof t === 'string') {
    const i = t.indexOf(':')
    return i > 0 ? { category: t.slice(0, i).trim(), name: t.slice(i + 1).trim(), source: 'user' } : null
  }
  if (t && typeof t === 'object') return { category: cleanName(t.category), name: cleanName(t.name), source: t.source === 'agent' ? 'agent' : t.source === 'system' ? 'system' : 'user' }
  return null
}

export function importMetadata(db, doc, { dryRun = false, overwriteNotes = false, by = null, mediaDir = config.mediaDir } = {}) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.files)) {
    throw new HttpError(400, 'Body must be a MotionBase metadata.json export (an object with a "files" array)')
  }
  const result = {
    dry_run: !!dryRun, total: doc.files.length, matched: 0, matched_by_path: 0, matched_by_name_size: 0,
    unmatched: [], unmatched_count: 0, files_changed: 0,
    categories_created: 0, tags_created: 0, tags_added: 0, folders_created: 0, folders_set: 0,
    notes_set: 0, notes_skipped: 0, favorites_set: 0, reviewed_set: 0, groups_created: 0, errors: [],
  }
  const err = (m) => { if (result.errors.length < 20) result.errors.push(m) }

  const catByName = new Map(db.prepare('SELECT * FROM tag_categories').all().map((c) => [c.name, c]))
  const tagId = db.prepare('SELECT id FROM tags WHERE category_id = ? AND name = ?')
  const media = path.resolve(mediaDir)

  const tx = db.transaction(() => {
    // 1. Categories and their tags (also those not used by any file).
    const ensureCategory = (name, meta = {}) => {
      let c = catByName.get(name)
      if (!c) {
        const selection = meta.selection === 'single' ? 'single' : 'multi'
        const desc = str(meta.description)?.trim() || null
        const { lastInsertRowid } = db.prepare('INSERT INTO tag_categories (name, is_system, description, selection) VALUES (?, 0, ?, ?)').run(name, desc, selection)
        c = db.prepare('SELECT * FROM tag_categories WHERE id = ?').get(lastInsertRowid)
        catByName.set(name, c)
        result.categories_created++
      }
      return c
    }
    const ensureTag = (cat, name, description) => {
      const ex = tagId.get(cat.id, name)
      if (ex) return ex.id
      const { lastInsertRowid } = db.prepare('INSERT INTO tags (category_id, name, description) VALUES (?, ?, ?)').run(cat.id, name, str(description)?.trim() || null)
      result.tags_created++
      return Number(lastInsertRowid)
    }
    for (const c of Array.isArray(doc.categories) ? doc.categories : []) {
      const name = cleanName(c?.name)
      if (!name) continue
      const existing = catByName.get(name)
      if (existing?.is_system) continue
      const cat = ensureCategory(name, c)
      for (const t of Array.isArray(c.tags) ? c.tags : []) {
        const tn = cleanName(typeof t === 'string' ? t : t?.name)
        if (tn) ensureTag(cat, tn, typeof t === 'string' ? null : t?.description)
      }
    }

    // 2. Folders (including empty ones).
    for (const p of Array.isArray(doc.folders) ? doc.folders : []) {
      try { result.folders_created += ensurePath(db, p).created } catch (e) { err(`folder "${p}": ${e.message}`) }
    }

    // 3. Files.
    const byPath = db.prepare('SELECT id, notes, folder_id, is_favorite, reviewed_at, group_id FROM files WHERE filepath = ?')
    const byId = db.prepare('SELECT id, notes, folder_id, is_favorite, reviewed_at, group_id FROM files WHERE id = ?')
    let nameSize = null // lazily built: "filename\0size" -> [ids]
    const lookupNameSize = (filename, size) => {
      if (!nameSize) {
        nameSize = new Map()
        for (const r of db.prepare('SELECT id, filename, file_size FROM files').all()) {
          for (const k of [`${r.filename}\0${r.file_size ?? ''}`, `${r.filename}\0`]) {
            if (!nameSize.has(k)) nameSize.set(k, [])
            nameSize.get(k).push(r.id)
          }
        }
      }
      const ids = nameSize.get(`${filename}\0${size ?? ''}`) || []
      return ids.length === 1 ? ids[0] : null
    }
    const addLink = db.prepare('INSERT OR IGNORE INTO file_tags (file_id, tag_id, source) VALUES (?, ?, ?)')

    const wantGroups = new Map() // title -> [{ id, pos }] of matched files not yet in a group

    for (const rec of doc.files) {
      const filename = str(rec?.filename)
      const rel = str(rec?.relative_path)?.replace(/\\/g, '/')
      let row = null
      let how = null
      if (rel && !path.isAbsolute(rel) && !rel.split('/').includes('..')) {
        row = byPath.get(path.join(media, rel)) || null
        if (row) how = 'path'
      }
      if (!row && filename) {
        const size = Number.isFinite(rec.file_size_bytes) ? rec.file_size_bytes : null
        const id = lookupNameSize(filename, size)
        if (id) { row = byId.get(id); how = 'name_size' }
      }
      if (!row) {
        result.unmatched_count++
        if (result.unmatched.length < 50) result.unmatched.push(rel || filename || '(no path)')
        continue
      }
      result.matched++
      result[how === 'path' ? 'matched_by_path' : 'matched_by_name_size']++
      const detail = {}

      // folder (only fills in unfiled files; never moves a file the user already filed)
      const fp = str(rec.folder_path)?.trim()
      if (fp && row.folder_id == null) {
        try {
          const { folder, created } = ensurePath(db, fp)
          result.folders_created += created
          db.prepare('UPDATE files SET folder_id = ? WHERE id = ?').run(folder.id, row.id)
          result.folders_set++
          detail.folder = fp
        } catch (e) { err(`${rel || filename}: folder "${fp}": ${e.message}`) }
      }

      // tags (system tags such as Aspect Ratio are automatic and skipped)
      let added = 0
      for (const raw of Array.isArray(rec.tags) ? rec.tags : []) {
        const t = parseTag(raw)
        if (!t || !t.category || !t.name || t.source === 'system') continue
        const existing = catByName.get(t.category)
        if (existing?.is_system) continue
        const cat = ensureCategory(t.category)
        const id = ensureTag(cat, t.name)
        if (addLink.run(row.id, id, t.source).changes) added++
      }
      result.tags_added += added
      if (added) detail.tags_added = added

      // notes (only fill empty notes unless overwrite_notes=1)
      const notes = str(rec.notes)
      if (notes && notes.trim() && notes !== row.notes) {
        if (!row.notes?.trim() || overwriteNotes) {
          db.prepare('UPDATE files SET notes = ? WHERE id = ?').run(notes, row.id)
          result.notes_set++
          detail.notes = true
        } else result.notes_skipped++
      }

      if (rec.favorite && !row.is_favorite) {
        db.prepare('UPDATE files SET is_favorite = 1 WHERE id = ?').run(row.id)
        result.favorites_set++
        detail.favorite = true
      }
      if (rec.reviewed && !row.reviewed_at) {
        db.prepare("UPDATE files SET needs_tagging = 0, reviewed_at = COALESCE(?, datetime('now')), reviewed_by = ? WHERE id = ?")
          .run(str(rec.reviewed_at), str(rec.reviewed_by) || 'user', row.id)
        result.reviewed_set++
        detail.reviewed = true
      }

      const gt = str(rec.group_title)?.trim()
      if (gt && row.group_id == null) {
        if (!wantGroups.has(gt)) wantGroups.set(gt, [])
        wantGroups.get(gt).push({ id: row.id, pos: Number.isInteger(rec.group_position) ? rec.group_position : 1e9 })
      }

      if (Object.keys(detail).length) {
        result.files_changed++
        if (!dryRun) recordEvent(db, row.id, by, 'metadata_imported', detail)
      }
    }
    // 4. Groups: files that shared a group_title in the export and are not grouped yet.
    for (const [title, members] of wantGroups) {
      if (members.length < 2) continue
      members.sort((a, b) => a.pos - b.pos || a.id - b.id)
      createGroup(db, members.map((m) => m.id), { title, by })
      result.groups_created++
    }
    if (dryRun) throw new DryRun()
  })
  try { tx() } catch (e) { if (!(e instanceof DryRun)) throw e }
  return result
}
