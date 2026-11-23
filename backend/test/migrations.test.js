import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'
import { applyBaseSchema } from '../src/db/schema.js'
import { runMigrations, migrations } from '../src/db/migrations.js'

test('legacy v0 database upgrades, keeps data, and is backed up', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mb-mig-'))
  const dbPath = path.join(dir, 'motionbase.db')
  try {
    const old = new Database(dbPath)
    applyBaseSchema(old)
    old.prepare("INSERT INTO tag_categories (name, is_system) VALUES ('Aspect Ratio', 1) ON CONFLICT DO NOTHING").run()
    old.prepare("INSERT INTO tag_categories (name, is_system) VALUES ('Brand', 0) ON CONFLICT DO NOTHING").run()
    old.prepare("INSERT INTO tags (category_id, name) VALUES ((SELECT id FROM tag_categories WHERE name='Aspect Ratio'), '16:9') ON CONFLICT DO NOTHING").run()
    old.prepare("INSERT INTO files (filepath, filename, file_type, needs_tagging) VALUES ('/m/a.mp4','a.mp4','video',0)").run()
    old.prepare("INSERT INTO files (filepath, filename, file_type) VALUES ('/m/b.mp4','b.mp4','video')").run()
    old.prepare("INSERT INTO file_tags (file_id, tag_id) SELECT 1, id FROM tags WHERE name='16:9'").run()
    assert.equal(old.pragma('user_version', { simple: true }), 0)

    runMigrations(old, { dbPath })
    assert.equal(old.pragma('user_version', { simple: true }), migrations.at(-1).version)
    assert.equal(old.prepare('SELECT source FROM file_tags WHERE file_id = 1').get().source, 'system')
    assert.equal(old.prepare('SELECT reviewed_by FROM files WHERE id = 1').get().reviewed_by, 'user')
    assert.equal(old.prepare('SELECT reviewed_at FROM files WHERE id = 2').get().reviewed_at, null)
    assert.ok(readdirSync(dir).some((f) => f.includes('.pre-v1-') && f.endsWith('.bak')))

    // idempotent
    runMigrations(old, { dbPath })
    assert.equal(readdirSync(dir).filter((f) => f.endsWith('.bak')).length, 1)
    old.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fresh database migrates without a backup', () => {
  const db = new Database(':memory:')
  runMigrations(db, { dbPath: ':memory:' })
  assert.equal(db.pragma('user_version', { simple: true }), migrations.at(-1).version)
  db.close()
})

test('v3 database upgrades to accounts (v4), keeps every row and leaves login off', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mb-mig4-'))
  const dbPath = path.join(dir, 'motionbase.db')
  try {
    const old = new Database(dbPath)
    applyBaseSchema(old)
    for (const m of migrations.filter((x) => x.version <= 3)) {
      old.transaction(() => { m.up(old); old.pragma(`user_version = ${m.version}`) })()
    }
    old.prepare("INSERT INTO files (filepath, filename, file_type, notes) VALUES ('/m/a.mp4','a.mp4','video','keep me')").run()
    old.prepare("INSERT INTO api_tokens (name, token_hash, token_prefix) VALUES ('old', 'h', 'mb_abcd')").run()
    old.prepare("INSERT INTO agent_activity (action) VALUES ('files.bulk')").run()
    assert.equal(old.pragma('user_version', { simple: true }), 3)

    runMigrations(old, { dbPath })
    assert.equal(old.pragma('user_version', { simple: true }), migrations.at(-1).version)
    const f = old.prepare('SELECT * FROM files WHERE id = 1').get()
    assert.equal(f.notes, 'keep me')
    assert.equal(f.uploaded_by, null)
    assert.equal(f.upload_source, null)
    assert.equal(old.prepare('SELECT user_id FROM api_tokens').get().user_id, null)
    assert.equal(old.prepare('SELECT COUNT(*) AS n FROM agent_activity').get().n, 1)
    assert.equal(old.prepare("SELECT value FROM settings WHERE key = 'auth_enabled'").get().value, 'false')
    for (const tbl of ['users', 'sessions', 'file_events', 'audit_log']) assert.equal(old.prepare(`SELECT COUNT(*) AS n FROM ${tbl}`).get().n, 0)
    assert.ok(readdirSync(dir).some((n) => n.includes('.pre-v4-') && n.endsWith('.bak')))
    old.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
