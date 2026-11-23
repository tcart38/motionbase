import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'fs'
import path from 'path'
import { startTestServer } from './helpers.js'

let t
before(async () => { t = await startTestServer() })
after(async () => { await t.close?.() })

function addFile(name) {
  const fp = path.join(t.mediaDir, name)
  writeFileSync(fp, 'x')
  const r = t.db.prepare("INSERT INTO files (filepath, filename, file_type) VALUES (?, ?, 'video')").run(fp, name)
  return { id: Number(r.lastInsertRowid), fp }
}

test('trash hides files, restore brings them back, purge deletes from disk', async () => {
  const a = addFile('a.mp4'); const b = addFile('b.mp4')
  let r = await t.get('/api/files')
  assert.equal(r.data.total, 2)

  r = await t.post('/api/files/trash', { file_ids: [a.id] })
  assert.equal(r.data.updated, 1)
  assert.equal((await t.get('/api/files')).data.total, 1)
  assert.equal((await t.get('/api/files?trash=1')).data.total, 1)
  assert.equal((await t.get('/api/files/counts')).data.trash, 1)

  await t.post('/api/files/trash', { file_ids: [a.id], deleted: false })
  assert.equal((await t.get('/api/files')).data.total, 2)

  // purge refuses files that aren't trashed
  r = await t.post('/api/files/purge', { file_ids: [b.id] })
  assert.equal(r.data.purged, 0)
  assert.ok(existsSync(b.fp))

  await t.post('/api/files/trash', { file_ids: [b.id] })
  r = await t.post('/api/files/purge', { file_ids: [b.id] })
  assert.equal(r.data.purged, 1)
  assert.ok(!existsSync(b.fp))
  assert.equal((await t.get('/api/files?trash=1')).data.total, 0)
})

test('agent API cannot see trashed files', async () => {
  const c = addFile('c.mp4')
  await t.post('/api/files/trash', { file_ids: [c.id] })
  const tok = (await t.post('/api/tokens', { name: 'test' })).data.token
  const h = { Authorization: `Bearer ${tok}` }
  const r = await t.get(`/api/agent/v1/files/${c.id}`, h)
  assert.equal(r.status, 404)
  const list = await t.get('/api/agent/v1/files', h)
  assert.ok(!list.data.files.some((f) => f.id === c.id))
})
