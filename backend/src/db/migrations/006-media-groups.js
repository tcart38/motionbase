// Migration 6: media groups. Several clips (e.g. the items of one LinkedIn post) can form ONE entry in the
// Library. Additive: a media_groups table plus files.group_id / files.group_position. Existing imports from
// multi-item posts ("[<postid>-<n>] caption (<n> of <total>).ext") are grouped automatically.
export const version = 6
export const name = 'media-groups'

export const ITEM_RE = /^\[(\d{10,})-(\d+)\] (.*) \((\d+) of (\d+)\)\.\w+$/

// Group files named like multi-item imports. Idempotent: files already in a group are left alone and a
// post needs >= 2 ungrouped matching files. Returns the number of groups created.
export function autoGroupImports(db) {
  const rows = db.prepare('SELECT id, filename, uploaded_by FROM files WHERE group_id IS NULL ORDER BY id').all()
  const byPost = new Map()
  for (const r of rows) {
    const m = ITEM_RE.exec(r.filename)
    if (!m) continue
    if (!byPost.has(m[1])) byPost.set(m[1], [])
    byPost.get(m[1]).push({ ...r, n: Number(m[2]), caption: m[3].trim() })
  }
  const mk = db.prepare('INSERT INTO media_groups (title, created_by) VALUES (?, ?)')
  const set = db.prepare('UPDATE files SET group_id = ?, group_position = ? WHERE id = ?')
  let created = 0
  for (const [postId, items] of byPost) {
    if (items.length < 2) continue
    items.sort((a, b) => a.n - b.n || a.id - b.id)
    const title = items[0].caption || `Post ${postId}`
    const by = items.find((i) => i.uploaded_by)?.uploaded_by ?? null
    const gid = Number(mk.run(title, by).lastInsertRowid)
    items.forEach((it, i) => set.run(gid, i, it.id))
    created++
  }
  return created
}

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ALTER TABLE files ADD COLUMN group_id INTEGER REFERENCES media_groups(id) ON DELETE SET NULL;
    ALTER TABLE files ADD COLUMN group_position INTEGER;
    CREATE INDEX IF NOT EXISTS idx_files_group_id ON files(group_id);
  `)
  autoGroupImports(db)
}
