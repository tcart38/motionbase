// Migration 5: optional self sign-up. Adds users.pending (1 = waiting for admin approval).
// Existing users default to 0, so they all count as approved. Sign-ups stay off until an admin enables them.
export const version = 5
export const name = 'signups'

export function up(db) {
  db.exec(`
    ALTER TABLE users ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;
    INSERT OR IGNORE INTO settings (key, value) VALUES ('signups_enabled', 'false');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('signups_require_approval', 'true');
  `)
}
