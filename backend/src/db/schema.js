export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filepath TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      file_type TEXT NOT NULL CHECK(file_type IN ('video', 'image')),
      duration REAL,
      width INTEGER,
      height INTEGER,
      fps REAL,
      aspect_ratio TEXT,
      date_added TEXT NOT NULL DEFAULT (datetime('now')),
      date_modified TEXT,
      thumbnail_path TEXT,
      needs_tagging INTEGER NOT NULL DEFAULT 1,
      is_missing INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tag_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_system INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES tag_categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      UNIQUE(category_id, name)
    );

    CREATE TABLE IF NOT EXISTS file_tags (
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (file_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_files_needs_tagging ON files(needs_tagging);
    CREATE INDEX IF NOT EXISTS idx_files_is_missing ON files(is_missing);
    CREATE INDEX IF NOT EXISTS idx_file_tags_file_id ON file_tags(file_id);
    CREATE INDEX IF NOT EXISTS idx_file_tags_tag_id ON file_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_tags_category_id ON tags(category_id);
  `)

  // Migrations for new columns
  try { db.exec("ALTER TABLE files ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0") } catch {}
  try { db.exec("ALTER TABLE files ADD COLUMN notes TEXT") } catch {}

  seed(db)
}

function seed(db) {
  const insertCat = db.prepare(
    'INSERT OR IGNORE INTO tag_categories (name, is_system) VALUES (?, ?)'
  )
  insertCat.run('Aspect Ratio', 1)
  insertCat.run('Brand', 0)
  insertCat.run('Video Type', 0)

  const arCat = db.prepare(
    "SELECT id FROM tag_categories WHERE name = 'Aspect Ratio'"
  ).get()

  if (arCat) {
    const insertTag = db.prepare(
      'INSERT OR IGNORE INTO tags (category_id, name) VALUES (?, ?)'
    )
    for (const name of ['16:9', '1:1', '4:5', '9:16']) {
      insertTag.run(arCat.id, name)
    }
  }

  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('scan_interval', '30')").run()
}
