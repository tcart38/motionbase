// Shared write path for file metadata. Filename changes touch the disk and stay in the route.

// Set the file's tag list to exactly `tagIds`, touching only the difference.
export function setFileTags(db, fileId, tagIds) {
  const want = new Set(tagIds.map(Number))
  const have = new Set(
    db.prepare('SELECT tag_id FROM file_tags WHERE file_id = ?').all(fileId).map((r) => r.tag_id)
  )
  const del = db.prepare('DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?')
  const ins = db.prepare('INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)')
  for (const id of have) if (!want.has(id)) del.run(fileId, id)
  for (const id of want) if (!have.has(id)) ins.run(fileId, id)
}

// changes: { needs_tagging, tag_ids, is_favorite, notes }
export function applyFileUpdate(db, file, changes) {
  const { needs_tagging, tag_ids, is_favorite, notes } = changes

  if (is_favorite !== undefined) {
    db.prepare('UPDATE files SET is_favorite = ? WHERE id = ?').run(is_favorite ? 1 : 0, file.id)
  }
  if (notes !== undefined) {
    db.prepare('UPDATE files SET notes = ? WHERE id = ?').run(notes ?? null, file.id)
  }
  if (needs_tagging !== undefined) {
    db.prepare('UPDATE files SET needs_tagging = ? WHERE id = ?').run(needs_tagging ? 1 : 0, file.id)
  }
  if (Array.isArray(tag_ids)) setFileTags(db, file.id, tag_ids)
}
