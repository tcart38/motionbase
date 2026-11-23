// Migration 1: virtual folders, review tracking, tag provenance, taxonomy descriptions.
export const version = 1
export const name = 'folders-review-source'

export function up(db) {
  db.exec(`
    CREATE TABLE folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_folders_unique_name ON folders(COALESCE(parent_id, 0), name COLLATE NOCASE);
    CREATE INDEX idx_folders_parent ON folders(parent_id);

    ALTER TABLE files ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;
    ALTER TABLE files ADD COLUMN reviewed_at TEXT;
    ALTER TABLE files ADD COLUMN reviewed_by TEXT;
    CREATE INDEX idx_files_folder_id ON files(folder_id);

    ALTER TABLE file_tags ADD COLUMN source TEXT NOT NULL DEFAULT 'user';

    ALTER TABLE tag_categories ADD COLUMN description TEXT;
    ALTER TABLE tag_categories ADD COLUMN selection TEXT NOT NULL DEFAULT 'multi' CHECK(selection IN ('single', 'multi'));
    ALTER TABLE tags ADD COLUMN description TEXT;

    -- Existing automatic links (aspect ratio) are system-owned.
    UPDATE file_tags SET source = 'system'
      WHERE tag_id IN (
        SELECT t.id FROM tags t JOIN tag_categories c ON c.id = t.category_id WHERE c.is_system = 1
      );

    -- Files already triaged by the user count as reviewed.
    UPDATE files SET reviewed_at = datetime('now'), reviewed_by = 'user' WHERE needs_tagging = 0;
  `)
}
