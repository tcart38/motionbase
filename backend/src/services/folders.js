import { HttpError } from './errors.js'

const MAX_NAME = 200

export function validateFolderName(name) {
  const n = typeof name === 'string' ? name.trim() : ''
  if (!n) throw new HttpError(400, 'Folder name is required')
  if (n.length > MAX_NAME) throw new HttpError(400, `Folder name must be at most ${MAX_NAME} characters`)
  if (/[/\\]/.test(n)) throw new HttpError(400, 'Folder name cannot contain / or \\')
  if (n === '.' || n === '..') throw new HttpError(400, 'Invalid folder name')
  return n
}

export function getFolder(db, id) {
  return db.prepare('SELECT * FROM folders WHERE id = ?').get(id)
}

// Flat list of folders with direct (file_count) and recursive (total_count) file counts.
export function getTree(db) {
  const rows = db.prepare(`
    SELECT f.id, f.parent_id, f.name, f.position, f.created_at,
      (SELECT COUNT(*) FROM files x WHERE x.folder_id = f.id AND x.is_missing = 0) AS file_count
    FROM folders f
    ORDER BY f.position, f.name COLLATE NOCASE, f.id
  `).all()

  const byId = new Map(rows.map((r) => [r.id, { ...r, total_count: r.file_count }]))
  // Accumulate counts leaf-to-root by walking each folder's ancestor chain.
  for (const r of rows) {
    let p = r.parent_id
    const seen = new Set()
    while (p != null && byId.has(p) && !seen.has(p)) {
      seen.add(p)
      byId.get(p).total_count += r.file_count
      p = byId.get(p).parent_id
    }
  }
  const { all_count } = db.prepare('SELECT COUNT(*) AS all_count FROM files WHERE is_missing = 0').get()
  const { unfiled_count } = db.prepare(
    'SELECT COUNT(*) AS unfiled_count FROM files WHERE is_missing = 0 AND folder_id IS NULL'
  ).get()
  return { folders: [...byId.values()], all_count, unfiled_count }
}

// Map of folder id -> "A/B/C" path.
export function getPathMap(db) {
  const rows = db.prepare('SELECT id, parent_id, name FROM folders').all()
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out = new Map()
  for (const r of rows) {
    const parts = []
    let cur = r
    const seen = new Set()
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      parts.unshift(cur.name)
      cur = cur.parent_id == null ? null : byId.get(cur.parent_id)
    }
    out.set(r.id, parts.join('/'))
  }
  return out
}

// The folder plus all of its descendants.
export function descendantIds(db, id) {
  return db.prepare(`
    WITH RECURSIVE d(id) AS (
      SELECT id FROM folders WHERE id = ?
      UNION ALL
      SELECT f.id FROM folders f JOIN d ON f.parent_id = d.id
    ) SELECT id FROM d
  `).all(id).map((r) => r.id)
}

function findChild(db, parentId, name) {
  return db.prepare(
    'SELECT * FROM folders WHERE COALESCE(parent_id, 0) = ? AND name = ? COLLATE NOCASE'
  ).get(parentId ?? 0, name)
}

function nextPosition(db, parentId) {
  const { m } = db.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS m FROM folders WHERE COALESCE(parent_id, 0) = ?'
  ).get(parentId ?? 0)
  return m
}

export function createFolder(db, { name, parentId = null }) {
  const n = validateFolderName(name)
  if (parentId != null && !getFolder(db, parentId)) throw new HttpError(404, 'Parent folder not found')
  if (findChild(db, parentId, n)) throw new HttpError(409, 'A folder with that name already exists here')
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO folders (parent_id, name, position) VALUES (?, ?, ?)'
  ).run(parentId, n, nextPosition(db, parentId))
  return getFolder(db, lastInsertRowid)
}

// Find-or-create a nested path like "Brands/Acme/2024". Returns the leaf folder
// and how many folders were created.
export function ensurePath(db, pathStr) {
  const parts = String(pathStr || '').split('/').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) throw new HttpError(400, 'Folder path is required')
  let parentId = null
  let created = 0
  let folder = null
  for (const part of parts) {
    const name = validateFolderName(part)
    folder = findChild(db, parentId, name)
    if (!folder) {
      folder = createFolder(db, { name, parentId })
      created++
    }
    parentId = folder.id
  }
  return { folder, created }
}

// Resolve an existing folder by path without creating it.
export function findByPath(db, pathStr) {
  const parts = String(pathStr || '').split('/').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  let parentId = null
  let folder = null
  for (const part of parts) {
    folder = findChild(db, parentId, part)
    if (!folder) return null
    parentId = folder.id
  }
  return folder
}

export function renameFolder(db, id, name) {
  const folder = getFolder(db, id)
  if (!folder) throw new HttpError(404, 'Not found')
  const n = validateFolderName(name)
  const clash = findChild(db, folder.parent_id, n)
  if (clash && clash.id !== folder.id) throw new HttpError(409, 'A folder with that name already exists here')
  db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(n, id)
  return getFolder(db, id)
}

export function moveFolder(db, id, newParentId, position) {
  const folder = getFolder(db, id)
  if (!folder) throw new HttpError(404, 'Not found')
  if (newParentId != null) {
    if (!getFolder(db, newParentId)) throw new HttpError(404, 'Target folder not found')
    if (descendantIds(db, id).includes(newParentId)) {
      throw new HttpError(422, 'Cannot move a folder into itself or one of its descendants')
    }
  }
  const parentChanged = (folder.parent_id ?? null) !== (newParentId ?? null)
  if (parentChanged) {
    if (findChild(db, newParentId, folder.name)) {
      throw new HttpError(409, 'A folder with that name already exists in the target')
    }
    db.prepare('UPDATE folders SET parent_id = ?, position = ? WHERE id = ?')
      .run(newParentId ?? null, position ?? nextPosition(db, newParentId), id)
  } else if (position !== undefined) {
    db.prepare('UPDATE folders SET position = ? WHERE id = ?').run(position, id)
  }
  return getFolder(db, id)
}

// Deleting a folder never deletes media: child folders and files move up one level.
export function deleteFolder(db, id) {
  const folder = getFolder(db, id)
  if (!folder) throw new HttpError(404, 'Not found')
  const parentId = folder.parent_id ?? null

  const children = db.prepare('SELECT * FROM folders WHERE parent_id = ? ORDER BY position, id').all(id)
  for (const child of children) {
    let name = child.name
    for (let i = 2; findChild(db, parentId, name); i++) name = `${child.name} (${i})`
    db.prepare('UPDATE folders SET parent_id = ?, name = ?, position = ? WHERE id = ?')
      .run(parentId, name, nextPosition(db, parentId), child.id)
  }
  const { changes } = db.prepare('UPDATE files SET folder_id = ? WHERE folder_id = ?').run(parentId, id)
  db.prepare('DELETE FROM folders WHERE id = ?').run(id)
  return { deleted: true, moved_folders: children.length, moved_files: changes }
}
