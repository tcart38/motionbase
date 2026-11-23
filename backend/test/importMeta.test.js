import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'fs'
import path from 'path'
import { startTestServer } from './helpers.js'

let t
before(async () => { t = await startTestServer() })
after(async () => { await t.close?.() })

test('buildNotesFromInfo formats LinkedIn-style metadata', async () => {
  const { buildNotesFromInfo } = await import('../src/services/importMeta.js')
  const n = buildNotesFromInfo({
    uploader: 'Jane Doe', webpage_url: 'https://www.linkedin.com/posts/x', extractor_key: 'LinkedIn',
    description: 'Great launch video', title: 'Jane Doe on LinkedIn: Great launch video',
  })
  assert.equal(n, 'Author: Jane Doe\nSource: https://www.linkedin.com/posts/x\nPlatform: LinkedIn\n\nGreat launch video')
  assert.equal(buildNotesFromInfo({}), '')
  assert.match(buildNotesFromInfo({ upload_date: '20250102', title: 'T' }), /Posted: 2025-01-02\nTitle: T/)
})

test('applyImportMeta fills empty notes only and removes the json', async () => {
  const { applyImportMeta } = await import('../src/services/importMeta.js')
  const ins = (name, notes) => t.db.prepare("INSERT INTO files (filepath, filename, file_type, notes) VALUES (?, ?, 'video', ?)")
    .run(path.join(t.mediaDir, name), name, notes).lastInsertRowid
  const a = ins('[abc123] First.mp4', null)
  const b = ins('[def456] Second.mp4', 'my own notes')
  writeFileSync(path.join(t.dataDir, 'abc123.info.json'), JSON.stringify({ id: 'abc123', uploader: 'Ann', description: 'Hello' }))
  writeFileSync(path.join(t.dataDir, 'def456.info.json'), JSON.stringify({ id: 'def456', uploader: 'Bob' }))
  const n = await applyImportMeta(t.db, t.dataDir)
  assert.equal(n, 1)
  assert.match(t.db.prepare('SELECT notes FROM files WHERE id=?').get(a).notes, /Author: Ann/)
  assert.equal(t.db.prepare('SELECT notes FROM files WHERE id=?').get(b).notes, 'my own notes')
})
