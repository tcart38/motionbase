import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, addFile } from './helpers.js'

let t, A, B, adminId, bobId
const PW = 'correct horse battery'
before(async () => {
  t = await startTestServer()
  const setup = await t.post('/api/auth/setup', { username: 'admin', display_name: 'Zed Admin', password: PW })
  A = { Cookie: setup.headers.get('set-cookie').split(';')[0] }
  adminId = setup.data.user.id
  bobId = (await t.post('/api/users', { username: 'bob', display_name: 'amy Bob', password: PW }, A)).data.user.id
  B = { Cookie: (await t.post('/api/auth/login', { username: 'bob', password: PW })).headers.get('set-cookie').split(';')[0] }
})
after(() => t.close())

async function upload(headers, name) {
  const fd = new FormData()
  fd.append('file', new Blob(['not really a video'], { type: 'video/mp4' }), name)
  const res = await fetch(t.baseUrl + '/api/upload', { method: 'POST', headers, body: fd })
  return { status: res.status, data: await res.json() }
}

test('uploads record who uploaded; the scanner marks other files as scan', async () => {
  const up = await upload(B, 'clip-one.mp4')
  assert.equal(up.status, 200)
  assert.ok(up.data.file_id)
  const f = (await t.get(`/api/files/${up.data.file_id}`, A)).data
  assert.deepEqual(f.uploader, { id: bobId, display_name: 'amy Bob', username: 'bob' })
  assert.equal(f.upload_source, 'user')
  const h = (await t.get(`/api/files/${f.id}/history`, A)).data
  assert.equal(h.events.length, 1)
  assert.equal(h.events[0].action, 'uploaded')
  assert.equal(h.events[0].actor.label, 'amy Bob')
  assert.equal(h.events[0].detail.original_name, 'clip-one.mp4')
  assert.deepEqual(h.uploaded.by, f.uploader)
  assert.equal(h.uploaded.source, 'user')

  // multipart uploads are allowed with a session; not without one
  assert.equal((await upload({}, 'nope.mp4')).status, 401)

  // dropped straight into the media folder -> found by the scan
  const { writeFileSync } = await import('fs')
  const path = await import('path')
  writeFileSync(path.join(t.mediaDir, 'dropped.mp4'), 'x')
  const { runScan } = await import('../src/services/scanner.js')
  await runScan()
  const dropped = t.db.prepare("SELECT * FROM files WHERE filename = 'dropped.mp4'").get()
  assert.equal(dropped.upload_source, 'scan')
  assert.equal(dropped.uploaded_by, null)
  const dh = (await t.get(`/api/files/${dropped.id}/history`, A)).data
  assert.equal(dh.events[0].actor.label, 'Library scan')
  assert.equal(dh.uploaded.by, null)
})

test('filter and sort by uploader', async () => {
  const adminFile = (await upload(A, 'by-admin.mp4')).data.file_id
  const unknown = addFile(t, 'unknown.mp4')
  const bobFiles = t.db.prepare('SELECT id FROM files WHERE uploaded_by = ?').all(bobId).map((r) => r.id)

  const byBob = (await t.get(`/api/files?uploader=${bobId}`, A)).data
  assert.deepEqual(byBob.files.map((f) => f.id).sort(), bobFiles.sort())
  assert.equal(byBob.total, bobFiles.length)
  const none = (await t.get('/api/files?uploader=none', A)).data
  assert.ok(none.files.every((f) => f.uploader === null && f.uploaded_by === null))
  assert.ok(none.files.some((f) => f.id === unknown))
  assert.equal((await t.get(`/api/files?uploader=${adminId}`, A)).data.files[0].id, adminFile)
  // combines with other filters
  assert.equal((await t.get(`/api/files?uploader=${bobId}&search=nomatchhere`, A)).data.total, 0)

  const asc = (await t.get('/api/files?sort=uploader&order=asc&limit=100', A)).data.files
  const names = asc.map((f) => f.uploader?.display_name ?? null)
  const known = names.filter(Boolean)
  assert.deepEqual(known, [...known].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())))
  assert.equal(names[0], 'amy Bob') // case-insensitive: amy before Zed
  assert.ok(names.slice(0, known.length).every(Boolean)) // unknown uploaders are last
  const desc = (await t.get('/api/files?sort=uploader&order=desc&limit=100', A)).data.files
  assert.equal(desc[0].uploader.display_name, 'Zed Admin')
  assert.equal(desc.at(-1).uploader, null)
  assert.equal(desc.length, asc.length)

  // "next" respects the filter
  const nx = (await t.get(`/api/files/${bobFiles[0]}/next?uploader=${bobId}`, A)).data
  assert.equal(nx.total, bobFiles.length)

  // agent API exposes the uploader name and filter
  const tok = (await t.post('/api/tokens', { name: 'a' }, A)).data.token
  const H = { Authorization: `Bearer ${tok}` }
  const ag = (await t.get(`/api/agent/v1/files?uploader=${bobId}`, H)).data
  assert.equal(ag.total, bobFiles.length)
  assert.ok(ag.files.every((f) => f.uploader === 'amy Bob' && f.upload_source === 'user'))
  const agNone = (await t.get('/api/agent/v1/files?uploader=none', H)).data
  assert.ok(agNone.files.every((f) => f.uploader === null))
})

test('GET /api/auth/directory lists every account (incl. disabled) for any signed-in user, minimal fields', async () => {
  await t.patch(`/api/users/${bobId}`, { disabled: true }, A)
  const anon = await t.get('/api/auth/directory')
  assert.equal(anon.status, 401)
  const res = await t.get('/api/auth/directory', A)
  assert.equal(res.status, 200)
  const ids = res.data.users.map((u) => u.id)
  assert.ok(ids.includes(adminId) && ids.includes(bobId))
  for (const u of res.data.users) assert.deepEqual(Object.keys(u).sort(), ['display_name', 'id', 'username'])
  await t.patch(`/api/users/${bobId}`, { disabled: false }, A)
  const B2 = { Cookie: (await t.post('/api/auth/login', { username: 'bob', password: PW })).headers.get('set-cookie').split(';')[0] }
  const asBob = await t.get('/api/auth/directory', B2)
  assert.equal(asBob.status, 200)
  assert.equal(asBob.data.users.length, 2)
})
