// Migration 2: agent API tokens, activity log (with undo snapshots), queue leases.
export const version = 2
export const name = 'agent-api'

export function up(db) {
  db.exec(`
    CREATE TABLE api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at TEXT
    );

    CREATE TABLE agent_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id INTEGER,
      agent_name TEXT,
      action TEXT NOT NULL,
      file_ids TEXT NOT NULL DEFAULT '[]',
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reverted_at TEXT
    );
    CREATE INDEX idx_agent_activity_created ON agent_activity(created_at);

    ALTER TABLE files ADD COLUMN agent_reviewed_at TEXT;
    ALTER TABLE files ADD COLUMN lease_owner TEXT;
    ALTER TABLE files ADD COLUMN lease_until TEXT;
    CREATE INDEX idx_files_agent_reviewed ON files(agent_reviewed_at);

    INSERT OR IGNORE INTO settings (key, value) VALUES ('agent_requires_confirmation', 'false');
  `)
}
