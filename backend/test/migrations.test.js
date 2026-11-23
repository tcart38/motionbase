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
