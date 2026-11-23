// Migration 3: soft delete. Trashed files stay on disk and in the database (so the
// scanner never re-imports them) until they are purged from the Trash view.
export const version = 3
export const name = 'trash'

export function up(db) {
  db.exec(`
    ALTER TABLE files ADD COLUMN deleted_at TEXT;
    CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files(deleted_at);
  `)
}
