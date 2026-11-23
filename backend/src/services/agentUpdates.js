// Validate-all-then-apply batch updates for the agent API.
import { HttpError } from './errors.js'
import {
  applyFileUpdate, computeTagSet, getFileTagIds, getSystemTagIds,
} from './fileMutations.js'
import { ensurePath, findByPath, getPathMap } from './folders.js'
import { snapshotFile, logActivity } from './activity.js'
import { actorFromAgent } from './history.js'

export const MAX_BATCH = 500
const MAX_NOTES = 20000

const ALLOWED = new Set([
  'file_id', 'add_tag_ids', 'remove_tag_ids', 'set_tag_ids', 'add_tags', 'remove_tags',
  'set_category_tags', 'notes', 'notes_mode', 'folder_id', 'folder_path',
  'favorite', 'is_favorite', 'mark_reviewed',
])

const ROLLBACK = Symbol('rollback')

export function getSetting(db, key, def = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? row.value : def
}
export const requiresConfirmation = (db) => getSetting(db, 'agent_requires_confirmation', 'false') === 'true'

const isIntArray = (v) => Array.isArray(v) && v.every((x) => Number.isInteger(x))

// Looks up / creates taxonomy while resolving, inside the batch transaction, so that
// create_missing items can reference each other and everything rolls back together.
function makeTaxonomy(db, createMissing, created) {
  const catByName = db.prepare('SELECT * FROM tag_categories WHERE name = ? COLLATE NOCASE')
  const tagByName = db.prepare('SELECT * FROM tags WHERE category_id = ? AND name = ? COLLATE NOCASE')
  const catById = db.prepare('SELECT * FROM tag_categories WHERE id = ?')
  const tagById = db.prepare(`
    SELECT t.*, c.is_system AS cat_system, c.name AS category FROM tags t
    JOIN tag_categories c ON c.id = t.category_id WHERE t.id = ?`)

  function category(name, errors, { create = createMissing, quiet = false } = {}) {
    let c = catByName.get(String(name))
    if (!c) {
      if (quiet) return null
      if (!create) { errors.push(`category "${name}" does not exist (set create_missing to create it)`); return null }
      const id = db.prepare('INSERT INTO tag_categories (name, is_system) VALUES (?, 0)').run(String(name).trim()).lastInsertRowid
      c = catById.get(id)
      created.categories.push(c.name)
    }
    if (c.is_system) { errors.push(`category "${c.name}" is system-managed and cannot be changed by agents`); return null }
    return c
  }

  function tag(cat, name, errors, { create = createMissing } = {}) {
    let t = tagByName.get(cat.id, String(name))
    if (!t) {
      if (!create) return null
      const id = db.prepare('INSERT INTO tags (category_id, name) VALUES (?, ?)').run(cat.id, String(name).trim()).lastInsertRowid
      t = db.prepare('SELECT * FROM tags WHERE id = ?').get(id)
      created.tags.push(`${cat.name}/${t.name}`)
    }
    return t
  }

  return { category, tag, catById, tagById }
}

function resolveItem(db, item, idx, tax, state) {
  const errors = []
  const err = (m) => errors.push(m)
  const out = { index: idx, file_id: item?.file_id, errors }

  if (!item || typeof item !== 'object' || Array.isArray(item)) { err('update must be an object'); return out }
  for (const k of Object.keys(item)) if (!ALLOWED.has(k)) err(`unknown field "${k}"`)

  if (!Number.isInteger(item.file_id)) { err('file_id must be an integer'); return out }
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(item.file_id)
  if (!file || file.deleted_at) { err(`file ${item.file_id} not found`); return out }
  if (state.seen.has(file.id)) { err(`duplicate file_id ${file.id} in batch`); return out }
  state.seen.add(file.id)
  out.file = file

  const changes = {}
  const systemIds = state.systemIds

  for (const k of ['add_tag_ids', 'remove_tag_ids', 'set_tag_ids']) {
    if (item[k] === undefined) continue
    if (!isIntArray(item[k])) { err(`${k} must be an array of integers`); continue }
    for (const id of item[k]) {
      const t = tax.tagById.get(id)
      if (!t) err(`tag ${id} not found`)
      else if (t.cat_system) err(`tag ${id} ("${t.category}/${t.name}") is system-managed and cannot be changed by agents`)
    }
  }

  // Name-based tag references
  const addIds = [...(Array.isArray(item.add_tag_ids) ? item.add_tag_ids : [])]
  const removeIds = [...(Array.isArray(item.remove_tag_ids) ? item.remove_tag_ids : [])]
  for (const [key, bucket, creates] of [['add_tags', addIds, true], ['remove_tags', removeIds, false]]) {
    if (item[key] === undefined) continue
    if (!Array.isArray(item[key])) { err(`${key} must be an array of {category, name}`); continue }
    for (const ref of item[key]) {
      if (!ref || typeof ref.category !== 'string' || typeof ref.name !== 'string' || !ref.name.trim()) {
        err(`${key} entries need string "category" and "name"`); continue
      }
      const cat = tax.category(ref.category, errors, { create: creates && state.createMissing, quiet: !creates })
      if (!cat) continue
      const t = tax.tag(cat, ref.name, errors, { create: creates && state.createMissing })
      if (t) bucket.push(t.id)
      else if (creates) err(`tag "${ref.category}/${ref.name}" does not exist (set create_missing to create it)`)
    }
  }

  // set_category_tags: replaces only the named categories
  const categorySets = []
  if (item.set_category_tags !== undefined) {
    const s = item.set_category_tags
    if (!s || typeof s !== 'object' || Array.isArray(s)) err('set_category_tags must be an object of {category: [tag names]}')
    else {
      for (const [catName, names] of Object.entries(s)) {
        const list = typeof names === 'string' ? [names] : names
        if (!Array.isArray(list) || !list.every((n) => typeof n === 'string' && n.trim())) {
          err(`set_category_tags["${catName}"] must be a tag name or an array of tag names`); continue
        }
        const cat = tax.category(catName, errors)
        if (!cat) continue
        const ids = []
        for (const n of list) {
          const t = tax.tag(cat, n, errors)
          if (t) ids.push(t.id)
          else err(`tag "${cat.name}/${n}" does not exist (set create_missing to create it)`)
        }
        categorySets.push({ cat, ids })
      }
    }
  }

  if (item.notes !== undefined) {
    if (item.notes !== null && typeof item.notes !== 'string') err('notes must be a string or null')
    else if (item.notes && item.notes.length > MAX_NOTES) err(`notes must be at most ${MAX_NOTES} characters`)
    else changes.notes = item.notes
  }
  if (item.notes_mode !== undefined) {
    if (!['replace', 'append'].includes(item.notes_mode)) err('notes_mode must be "replace" or "append"')
    else changes.notes_mode = item.notes_mode
  }

  const fav = item.favorite ?? item.is_favorite
  if (fav !== undefined) {
    if (typeof fav !== 'boolean') err('favorite must be a boolean')
    else changes.is_favorite = fav
  }
  if (item.mark_reviewed !== undefined) {
    if (typeof item.mark_reviewed !== 'boolean') err('mark_reviewed must be a boolean')
    else if (item.mark_reviewed) changes.mark_reviewed = true
  }

  if (item.folder_id !== undefined && item.folder_path !== undefined) err('use either folder_id or folder_path, not both')
  else if (item.folder_id !== undefined) {
    if (item.folder_id === null) changes.folder_id = null
    else if (!Number.isInteger(item.folder_id) || !db.prepare('SELECT 1 FROM folders WHERE id = ?').get(item.folder_id)) {
      err(`folder ${item.folder_id} not found`)
    } else changes.folder_id = item.folder_id
  } else if (item.folder_path !== undefined) {
    if (typeof item.folder_path !== 'string' || !item.folder_path.trim()) err('folder_path must be a non-empty string')
    else {
      try {
        let f = findByPath(db, item.folder_path)
        if (!f) {
          if (!state.createMissing) err(`folder "${item.folder_path}" does not exist (set create_missing to create it)`)
          else {
            const r = ensurePath(db, item.folder_path)
            f = r.folder
            if (r.created) state.created.folders.push(item.folder_path.trim())
          }
        }
        if (f) changes.folder_id = f.id
      } catch (e) { err(e.message) }
    }
  }

  // Resolve the final tag set: set_tag_ids, then category sets, then add/remove.
  const touchesTags = item.set_tag_ids !== undefined || categorySets.length || addIds.length || removeIds.length
  if (touchesTags && errors.length === 0) {
    const protect = { systemIds, protectSystem: true }
    let ids = getFileTagIds(db, file.id)
    if (Array.isArray(item.set_tag_ids)) ids = computeTagSet(ids, { tag_ids: item.set_tag_ids }, protect)
    for (const { cat, ids: want } of categorySets) {
      const inCat = new Set(db.prepare('SELECT id FROM tags WHERE category_id = ?').all(cat.id).map((r) => r.id))
      ids = [...ids.filter((id) => !inCat.has(id)), ...want]
    }
    ids = computeTagSet(ids, { add_tag_ids: addIds, remove_tag_ids: removeIds }, protect)
    changes.tag_ids = [...new Set(ids)]

    // single-select categories hold at most one tag
    const rows = db.prepare(`
      SELECT t.id, c.id AS cid, c.name AS cname, c.selection FROM tags t
      JOIN tag_categories c ON c.id = t.category_id
      WHERE t.id IN (${changes.tag_ids.map(() => '?').join(',') || 'NULL'})`).all(...changes.tag_ids)
    const per = {}
    for (const r of rows) if (r.selection === 'single') (per[r.cname] = per[r.cname] || []).push(r.id)
    for (const [cname, list] of Object.entries(per)) {
      if (list.length > 1) err(`category "${cname}" is single-select but would end up with ${list.length} tags (use set_category_tags to replace)`)
    }
  }

  out.changes = changes
  return out
}

function diffTags(before, after) {
  const key = (t) => `${t.category}/${t.name}`
  const b = new Set(before.tags.map(key)), a = new Set(after.tags.map(key))
  return { added: [...a].filter((k) => !b.has(k)), removed: [...b].filter((k) => !a.has(k)) }
}

function summarizeChange(before, after) {
  const { added, removed } = diffTags(before, after)
  const s = { tags_added: added, tags_removed: removed }
  if (before.folder_path !== after.folder_path) s.folder = { from: before.folder_path, to: after.folder_path }
  if (before.notes !== after.notes) s.notes_changed = true
  if (before.is_favorite !== after.is_favorite) s.favorite = !!after.is_favorite
  if (before.reviewed_at !== after.reviewed_at || before.agent_reviewed_at !== after.agent_reviewed_at) s.reviewed = true
  const changed = added.length || removed.length || s.folder || s.notes_changed || s.favorite !== undefined || s.reviewed
  return { changed: !!changed, ...s }
}

// Returns { status, body }. Nothing is written unless every item validates (and not dry_run).
export function runBatch(db, { updates, create_missing = false, dry_run = false }, { agent, action = 'files.bulk' } = {}) {
  if (!Array.isArray(updates) || updates.length === 0) throw new HttpError(400, 'updates must be a non-empty array')
  if (updates.length > MAX_BATCH) throw new HttpError(413, `At most ${MAX_BATCH} updates per request`)
  if (typeof create_missing !== 'boolean' || typeof dry_run !== 'boolean') {
    throw new HttpError(400, 'create_missing and dry_run must be booleans')
  }

  const confirm = requiresConfirmation(db)
  const actor = `agent:${agent?.name || 'unknown'}`
  const by = actorFromAgent(agent)
  let payload

  try {
    db.transaction(() => {
      const created = { categories: [], tags: [], folders: [] }
      const state = { seen: new Set(), createMissing: create_missing, created, systemIds: getSystemTagIds(db) }
      const tax = makeTaxonomy(db, create_missing, created)

      const resolved = updates.map((u, i) => resolveItem(db, u, i, tax, state))
      const failed = resolved.filter((r) => r.errors.length)
      if (failed.length) {
        payload = {
          status: 422,
          body: {
            error: `${failed.length} of ${updates.length} updates failed validation; nothing was applied`,
            errors: failed.map((r) => ({ index: r.index, file_id: r.file_id, errors: r.errors })),
          },
        }
        throw ROLLBACK
      }

      const pathMap = getPathMap(db)
      const before = {}, after = {}, results = []
      for (const r of resolved) {
        const b = snapshotFile(db, r.file.id, pathMap)
        applyFileUpdate(db, r.file, r.changes, { actor, by, systemIds: state.systemIds, requireConfirmation: confirm })
        const a = snapshotFile(db, r.file.id, pathMap)
        const summary = summarizeChange(b, a)
        results.push({ file_id: r.file.id, ...summary })
        if (summary.changed) { before[r.file.id] = b; after[r.file.id] = a }
      }

      const changedIds = Object.keys(before).map(Number)
      let activityId = null
      if (!dry_run && changedIds.length) {
        activityId = logActivity(db, { agent, action, fileIds: changedIds, before, after })
      }
      payload = {
        status: 200,
        body: {
          dry_run, applied: dry_run ? 0 : changedIds.length, unchanged: results.length - changedIds.length,
          activity_id: activityId, created, results,
        },
      }
      if (dry_run) throw ROLLBACK
    })()
  } catch (e) {
    if (e !== ROLLBACK) throw e
  }
  return payload
}
