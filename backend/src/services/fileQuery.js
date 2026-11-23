const UNTAGGED_SQL = `NOT EXISTS (
        SELECT 1 FROM file_tags ft
        JOIN tags t ON t.id = ft.tag_id
        JOIN tag_categories c ON c.id = t.category_id
        WHERE ft.file_id = f.id AND c.is_system = 0
      )`

export const SORT_COLUMNS = { date_added: 'f.date_added', filename: 'f.filename', duration: 'f.duration' }

const UPLOADER_NAME = '(SELECT u.display_name FROM users u WHERE u.id = f.uploaded_by)'

// ORDER BY expression for a sort key. Unknown keys fall back to date_added. sort=uploader orders by the
// uploader's display name with unknown uploaders always last.
export function orderBy(sort, order) {
  const dir = order === 'asc' ? 'ASC' : 'DESC'
  if (sort === 'uploader') return `${UPLOADER_NAME} IS NULL, ${UPLOADER_NAME} COLLATE NOCASE ${dir}, f.id ${dir}`
  return `${SORT_COLUMNS[sort] || 'f.date_added'} ${dir}`
}

// Shared WHERE-clause builder for the file list and the filter-aware "next file" lookup.
// Tag filtering is AND-across-categories, OR-within-category.
export function buildFileFilter(db, { view = 'all', tags = '', search = '', favorites = '', untagged = '', folder = '', subfolders = '', status = '', source = '', trash = '', uploader = '', group = '' } = {}) {
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

  // uploader=none -> unknown uploader (before accounts, scanned, or login off); uploader=<userId>
  let uploaderCondition = null
  const uploaderParams = []
  if (uploader === 'none') {
    uploaderCondition = 'f.uploaded_by IS NULL'
  } else if (uploader !== '' && uploader != null && Number.isInteger(Number(uploader))) {
    uploaderCondition = 'f.uploaded_by = ?'
    uploaderParams.push(Number(uploader))
  }

  // "Untagged" ignores the auto-applied Aspect Ratio category (is_system = 1) —
  // a file with only its aspect ratio tag still counts as having no real tags.
  const untaggedCondition = untagged === '1' ? UNTAGGED_SQL : null

  // Review status (used by the agent API)
  const STATUS = {
    pending: 'f.reviewed_at IS NULL AND f.agent_reviewed_at IS NULL',
    needs_review: 'f.agent_reviewed_at IS NOT NULL AND f.reviewed_at IS NULL',
    agent_reviewed: 'f.agent_reviewed_at IS NOT NULL',
    reviewed: 'f.reviewed_at IS NOT NULL',
  }
  const statusCondition = STATUS[status] || null

  // group=<id> -> the members of that media group
  const groupId = group !== '' && group != null && Number.isInteger(Number(group)) ? Number(group) : null

  const where = [
    'f.is_missing = 0',
    groupId != null ? 'f.group_id = ?' : null,
    trash === '1' || trash === 1 || trash === true ? 'f.deleted_at IS NOT NULL' : 'f.deleted_at IS NULL',
    view === 'inbox' ? 'f.reviewed_at IS NULL' : null,
    favorites === '1' ? 'f.is_favorite = 1' : null,
    search.trim() ? '(f.filename LIKE ? OR f.notes LIKE ?)' : null,
    folderCondition,
    uploaderCondition,
    untaggedCondition,
    status === 'untagged' ? UNTAGGED_SQL : null,
    statusCondition,
    source === 'agent' ? "EXISTS (SELECT 1 FROM file_tags ag WHERE ag.file_id = f.id AND ag.source = 'agent')" : null,
    ...tagConditions,
  ].filter(Boolean).join(' AND ')

  return { where, params: [...(groupId != null ? [groupId] : []), ...preParams, ...folderParams, ...uploaderParams, ...tagParams] }
}

// Attach full tag objects (`tags`) to each file row. Returns new objects.
export function attachTags(db, rows) {
  const fileIds = rows.map((r) => r.id)
  const tagsByFile = {}
  if (fileIds.length > 0) {
    const tagData = db.prepare(`
      SELECT ft.file_id, ft.source, t.id, t.name, t.category_id, c.name AS category_name
      FROM file_tags ft
      JOIN tags t ON t.id = ft.tag_id
      JOIN tag_categories c ON c.id = t.category_id
      WHERE ft.file_id IN (${fileIds.map(() => '?').join(',')})
      ORDER BY c.name, t.name
    `).all(...fileIds)

    for (const t of tagData) {
      ;(tagsByFile[t.file_id] = tagsByFile[t.file_id] || []).push({
        id: t.id, name: t.name, category_id: t.category_id, category_name: t.category_name, source: t.source,
      })
    }
  }
  const uploaders = uploadersFor(db, rows)
  const groups = groupInfoFor(db, rows)
  return rows.map((r) => ({
    ...r, tags: tagsByFile[r.id] || [],
    group_title: r.group_id ? groups.get(r.group_id)?.title ?? null : null,
    group_size: r.group_id ? groups.get(r.group_id)?.size ?? 0 : null,
    uploader: r.uploaded_by ? uploaders.get(r.uploaded_by) ?? null : null,
  }))
}

export function getFileWithTags(db, id) {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id)
  if (!file) return null
  return attachTags(db, [file])[0]
}

// Map userId -> { id, display_name, username } for the uploaders of these file rows.
export function uploadersFor(db, rows) {
  const ids = [...new Set(rows.map((r) => r.uploaded_by).filter(Boolean))]
  if (!ids.length) return new Map()
  return new Map(db.prepare(
    `SELECT id, display_name, username FROM users WHERE id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids).map((u) => [u.id, u]))
}

// Group fields for file rows: Map groupId -> { title, size (live members) }
export function groupInfoFor(db, rows) {
  const gids = [...new Set(rows.map((r) => r.group_id).filter(Boolean))]
  if (!gids.length) return new Map()
  const ph = gids.map(() => '?').join(',')
  const titles = new Map(db.prepare(`SELECT id, title FROM media_groups WHERE id IN (${ph})`).all(...gids).map((g) => [g.id, g.title]))
  const sizes = new Map(db.prepare(
    `SELECT group_id, COUNT(*) AS n FROM files WHERE group_id IN (${ph}) AND deleted_at IS NULL AND is_missing = 0 GROUP BY group_id`
  ).all(...gids).map((r) => [r.group_id, r.n]))
  return new Map(gids.map((g) => [g, { title: titles.get(g) ?? null, size: sizes.get(g) ?? 0 }]))
}

// Library collapse: a group counts as ONE entry, represented by its first matching member
// (ORDER BY group_position, id), when ANY member matches the filters. Same params as `where`.
// Callers drop the helper column rn from the rows.
export function collapsedSource(where) {
  return {
    with: `WITH matched AS (SELECT f.* FROM files f WHERE ${where}),
      ranked AS (SELECT matched.*, CASE WHEN group_id IS NULL THEN 1
        ELSE ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY group_position IS NULL, group_position, id) END AS rn FROM matched)`,
    from: 'ranked f WHERE f.rn = 1',
  }
}
