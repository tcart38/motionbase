export const SORT_COLUMNS = { date_added: 'f.date_added', filename: 'f.filename', duration: 'f.duration' }

// Shared WHERE-clause builder for the file list and the filter-aware "next file" lookup.
// Tag filtering is AND-across-categories, OR-within-category.
export function buildFileFilter(db, { view = 'all', tags = '', search = '', favorites = '', untagged = '', folder = '', subfolders = '' } = {}) {
  const tagIds = tags ? String(tags).split(',').map(Number).filter(Boolean) : []
  const tagConditions = []
  const tagParams = []

  if (tagIds.length > 0) {
    const tagRows = db.prepare(
      `SELECT t.id, t.category_id FROM tags t WHERE t.id IN (${tagIds.map(() => '?').join(',')})`
    ).all(...tagIds)

    const byCategory = {}
    for (const t of tagRows) {
      ;(byCategory[t.category_id] = byCategory[t.category_id] || []).push(t.id)
    }

    for (const catTagIds of Object.values(byCategory)) {
      tagConditions.push(
        `EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id AND ft.tag_id IN (${catTagIds.map(() => '?').join(',')}))`
      )
      tagParams.push(...catTagIds)
    }
  }

  const preParams = []
  if (search.trim()) {
    const like = `%${search.trim()}%`
    preParams.push(like, like)
  }

  // folder=none -> unfiled; folder=<id> -> that folder (plus descendants with subfolders=1)
  let folderCondition = null
  const folderParams = []
  if (folder === 'none') {
    folderCondition = 'f.folder_id IS NULL'
  } else if (folder !== '' && folder != null && Number.isInteger(Number(folder))) {
    if (subfolders === '1' || subfolders === 1 || subfolders === true) {
      folderCondition = `f.folder_id IN (
        WITH RECURSIVE d(id) AS (
          SELECT id FROM folders WHERE id = ?
          UNION ALL SELECT x.id FROM folders x JOIN d ON x.parent_id = d.id
        ) SELECT id FROM d)`
    } else {
      folderCondition = 'f.folder_id = ?'
    }
    folderParams.push(Number(folder))
  }

  // "Untagged" ignores the auto-applied Aspect Ratio category (is_system = 1) —
  // a file with only its aspect ratio tag still counts as having no real tags.
  const untaggedCondition = untagged === '1'
    ? `NOT EXISTS (
        SELECT 1 FROM file_tags ft
        JOIN tags t ON t.id = ft.tag_id
        JOIN tag_categories c ON c.id = t.category_id
        WHERE ft.file_id = f.id AND c.is_system = 0
      )`
    : null

  const where = [
    'f.is_missing = 0',
    view === 'inbox' ? 'f.needs_tagging = 1' : null,
    favorites === '1' ? 'f.is_favorite = 1' : null,
    search.trim() ? '(f.filename LIKE ? OR f.notes LIKE ?)' : null,
    folderCondition,
    untaggedCondition,
    ...tagConditions,
  ].filter(Boolean).join(' AND ')

  return { where, params: [...preParams, ...folderParams, ...tagParams] }
}

// Attach full tag objects (`tags`) to each file row. Returns new objects.
export function attachTags(db, rows) {
  const fileIds = rows.map((r) => r.id)
  const tagsByFile = {}
  if (fileIds.length > 0) {
    const tagData = db.prepare(`
      SELECT ft.file_id, t.id, t.name, t.category_id, c.name AS category_name
      FROM file_tags ft
      JOIN tags t ON t.id = ft.tag_id
      JOIN tag_categories c ON c.id = t.category_id
      WHERE ft.file_id IN (${fileIds.map(() => '?').join(',')})
      ORDER BY c.name, t.name
    `).all(...fileIds)

    for (const t of tagData) {
      ;(tagsByFile[t.file_id] = tagsByFile[t.file_id] || []).push({
        id: t.id, name: t.name, category_id: t.category_id, category_name: t.category_name,
      })
    }
  }
  return rows.map((r) => ({ ...r, tags: tagsByFile[r.id] || [] }))
}

export function getFileWithTags(db, id) {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id)
  if (!file) return null
  return attachTags(db, [file])[0]
}
