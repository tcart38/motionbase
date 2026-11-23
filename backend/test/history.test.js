import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, addFile } from './helpers.js'

let t, A, B, adminId, bobId
const PW = 'correct horse battery'
before(async () => {
  t = await startTestServer()
  const setup = await t.post('/api/auth/setup', { username: 'admin', display_name: 'Ada Admin', password: PW })
  A = { Cookie: setup.headers.get('set-cookie').split(';')[0] }
  adminId = setup.data.user.id
  bobId = (await t.post('/api/users', { username: 'bob', display_name: 'Bob B', password: PW }, A)).data.user.id
  const l = await t.post('/api/auth/login', { username: 'bob', password: PW })
  B = { Cookie: l.headers.get('set-cookie').split(';')[0] }
})
after(() => t.close())

const hist = async (id, h = A) => (await t.get(`/api/files/${id}/history`, h)).data
const actions = (h) => h.events.map((e) => e.action)

test('UI changes record events with the right actor and detail', async () => {
  const id = addFile(t, 'h1.mp4')
  const brand = t.db.prepare("SELECT id FROM tag_categories WHERE name = 'Brand'").get().id
  const tag = (await t.post('/api/tags', { category_id: brand, name: 'Acme' }, A)).data
  const folder = (await t.post('/api/folders', { name: 'Shoots' }, A)).data

  await t.patch(`/api/files/${id}`, { tag_ids: [tag.id], notes: 'first note', is_favorite: true, folder_id: folder.id, mark_reviewed: true }, B)
  let h = await hist(id)
  const by = (a) => h.events.find((e) => e.action === a)
  for (const a of ['tags_changed', 'notes_changed', 'favorite_changed', 'folder_changed', 'reviewed']) assert.ok(by(a), a)
  assert.deepEqual(by('tags_changed').detail, { added: [{ category: 'Brand', name: 'Acme' }], removed: [] })
  assert.deepEqual(by('notes_changed').detail, { from: null, to: 'first note' })
  assert.deepEqual(by('folder_changed').detail, { from_path: null, to_path: 'Shoots' })
  assert.deepEqual(by('favorite_changed').detail, { from: false, to: true })
  assert.deepEqual(by('reviewed').detail, { by: 'user' })
  assert.ok(h.events.filter((e) => e.action !== 'uploaded').every((e) => e.actor.user_id === bobId && e.actor.label === 'Bob B'))

  await t.patch(`/api/files/${id}`, { tag_ids: [], notes: 'x'.repeat(900), needs_tagging: true }, A)
  h = await hist(id)
  assert.equal(h.events[0].action === 'unreviewed' || actions(h).includes('unreviewed'), true)
  const removed = h.events.find((e) => e.action === 'tags_changed' && e.actor.user_id === adminId)
  assert.deepEqual(removed.detail.removed, [{ category: 'Brand', name: 'Acme' }])
  assert.equal(h.events.find((e) => e.action === 'notes_changed' && e.actor.user_id === adminId).detail.to.length, 500)

  // unchanged writes record nothing
  const n = h.events.length
  await t.patch(`/api/files/${id}`, { notes: 'x'.repeat(900) }, A)
  assert.equal((await hist(id)).events.length, n)

  await t.patch(`/api/files/${id}`, { filename: 'renamed.mp4' }, A)
  assert.deepEqual((await hist(id)).events[0].detail, { from: 'h1.mp4', to: 'renamed.mp4' })
  assert.equal((await hist(id)).events[0].action, 'renamed')
  // newest first
  const ids = (await hist(id)).events.map((e) => e.id)
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a))
})

test('bulk, trash and restore are recorded; purge goes to the audit log', async () => {
  const a = addFile(t, 'b1.mp4'), b = addFile(t, 'b2.mp4')
  const folder = (await t.post('/api/folders', { name: 'Bulk' }, A)).data
  await t.post('/api/files/bulk', { file_ids: [a, b], folder_id: folder.id, is_favorite: true }, B)
  for (const id of [a, b]) assert.deepEqual(actions(await hist(id)).filter((x) => x !== 'uploaded').sort(), ['favorite_changed', 'folder_changed'])
  assert.equal((await hist(a)).events[0].actor.label, 'Bob B')

  await t.post('/api/files/trash', { file_ids: [a] }, B)
  await t.post('/api/files/trash', { file_ids: [a] }, B) // already trashed -> no duplicate event
  await t.post('/api/files/trash', { file_ids: [a], deleted: false }, A)
  const ev = actions(await hist(a))
  assert.deepEqual(ev.slice(0, 2), ['restored', 'trashed'])
  assert.equal(ev.filter((x) => x === 'trashed').length, 1)

  await t.post('/api/files/trash', { file_ids: [b] }, A)
  assert.equal((await t.post('/api/files/purge', { file_ids: [b] }, B)).status, 403)
  assert.equal((await t.post('/api/files/purge', { file_ids: [b] }, A)).data.purged, 1)
  const entry = (await t.get('/api/admin/audit', A)).data.entries.find((e) => e.action === 'purge')
  assert.equal(entry.actor_label, 'Ada Admin')
  assert.deepEqual(entry.detail.files, [{ id: b, filename: 'b2.mp4' }])
  assert.equal((await t.get(`/api/files/${b}/history`, A)).status, 404)
})

test('folder import from disk records folder moves', async () => {
  const { mkdirSync, writeFileSync } = await import('fs')
  const path = await import('path')
  mkdirSync(path.join(t.mediaDir, 'sub'), { recursive: true })
  const fp = path.join(t.mediaDir, 'sub', 'in-sub.mp4')
  writeFileSync(fp, 'x')
  const id = addFile(t, 'in-sub.mp4', { filepath: fp })
  await t.post('/api/folders/import-from-disk', {}, A)
  const e = (await hist(id)).events.find((x) => x.action === 'folder_changed')
  assert.equal(e.detail.to_path, 'sub')
  assert.equal(e.actor.label, 'Ada Admin')
})

test('agent changes show the token name and owner; revert is recorded', async () => {
  const id = addFile(t, 'ag1.mp4')
  const tok = (await t.post('/api/tokens', { name: 'Claude Desktop' }, B)).data
  const H = { Authorization: `Bearer ${tok.token}` }
  const cat = (await t.post('/api/agent/v1/files/bulk', {
    updates: [{ file_id: id, add_tags: [{ category: 'Mood', name: 'Calm' }], notes: 'agent note', mark_reviewed: true }],
    create_missing: true,
  }, H))
  assert.equal(cat.status, 200, JSON.stringify(cat.data))
  let h = await hist(id)
  for (const a of ['tags_changed', 'notes_changed', 'agent_update', 'reviewed']) assert.ok(actions(h).includes(a), a)
  assert.ok(h.events.filter((e) => e.action !== 'uploaded').every((e) => e.actor.label === 'Claude Desktop (agent)' && e.actor.user_id === bobId))
  assert.equal(h.events.find((e) => e.action === 'notes_changed').detail.to, 'agent note')

  // dry runs leave no trace
  const before = h.events.length
  await t.post('/api/agent/v1/files/bulk', { updates: [{ file_id: id, notes: 'dry' }], dry_run: true }, H)
  assert.equal((await hist(id)).events.length, before)

  // revert is admin only, recorded as 'reverted', and the revert is logged
  const act = (await t.get('/api/activity', A)).data.activity[0]
  assert.equal((await t.post(`/api/activity/${act.id}/revert`, {}, B)).status, 403)
  assert.equal((await t.post(`/api/activity/${act.id}/revert`, {}, A)).status, 200)
  h = await hist(id)
  assert.equal(h.events[0].action, 'reverted')
  assert.equal(h.events[0].actor.label, 'Ada Admin')
})

test('old files get a synthesized upload entry', async () => {
  const id = addFile(t, 'old.mp4') // no events, no uploader
  const h = await hist(id)
  assert.equal(h.events.length, 1)
  assert.equal(h.events[0].action, 'uploaded')
  assert.equal(h.events[0].synthetic, true)
  assert.equal(h.events[0].actor.label, null)
  assert.deepEqual(h.uploaded.by, null)
  assert.ok(h.uploaded.at)
  assert.equal((await t.get('/api/files/99999/history', A)).status, 404)
})
