// Migration 4: optional accounts, uploader tracking and per-file history.
// Purely additive; login stays off (auth_enabled = 'false') until someone turns it on.
export const version = 4
export const name = 'accounts'

export function up(db) {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      disabled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      user_agent TEXT
    );
    CREATE INDEX idx_sessions_user ON sessions(user_id);

    ALTER TABLE files ADD COLUMN uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE files ADD COLUMN upload_source TEXT;
    CREATE INDEX idx_files_uploaded_by ON files(uploaded_by);

    ALTER TABLE api_tokens ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

    CREATE TABLE file_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      token_id INTEGER,
      actor_label TEXT,
      action TEXT NOT NULL,
      detail_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_file_events_file ON file_events(file_id);

    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_label TEXT,
      action TEXT NOT NULL,
      detail_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES ('auth_enabled', 'false');
  `)
}
