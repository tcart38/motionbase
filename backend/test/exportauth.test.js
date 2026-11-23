import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, addFile } from './helpers.js'

let t, A, U, adminId
const PW = 'correct horse battery'
const cookie = (r) => ({ Cookie: (r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie')]).find((x) => x?.startsWith('mb_session=')).split(';')[0] })

before(async () => { t = await startTestServer() })
after(() => t.close())

test('login off: export and restore are open', async () => {
  addFile(t, 'a.mp4', { file_size: 1 })
  assert.equal((await t.get('/api/export/metadata?format=json')).status, 200)
  assert.equal((await t.get('/api/export/download.zip')).status, 200)
  assert.equal((await t.get('/api/export/jobs')).status, 200)
  assert.equal((await t.post('/api/import/metadata?dry_run=1', { files: [] })).status, 200)
})

test('login on: admins only (401 anonymous, 403 for users); actions are audited and attributed', async () => {
  const setup = await t.post('/api/auth/setup', { username: 'admin', display_name: 'The Admin', password: PW })
  A = cookie(setup)
  adminId = setup.data.user.id
  await t.post('/api/users', { username: 'bob', display_name: 'Bob', role: 'user', password: PW }, A)
  U = cookie(await t.post('/api/auth/login', { username: 'bob', password: PW }))

  const routes = [
    ['get', '/api/export/metadata?format=csv'], ['get', '/api/export/download.zip'], ['get', '/api/export/jobs'],
    ['post', '/api/export/jobs'], ['get', '/api/export/jobs/x'], ['post', '/api/export/jobs/x/cancel'],
    ['del', '/api/export/jobs/x'], ['get', '/api/export/jobs/x/download'], ['post', '/api/import/metadata'],
  ]
  for (const [m, u] of routes) {
    assert.equal((await t[m](u)).status, 401, `anon ${m} ${u}`)
    assert.equal((await t[m](u, ...(m === 'post' ? [{}, U] : [U]))).status, 403, `user ${m} ${u}`)
  }

  const mark = t.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM audit_log').get().m
  assert.equal((await t.get('/api/export/metadata?format=csv', A)).status, 200)
  assert.equal((await t.get('/api/export/download.zip', A)).status, 200)

  const id = t.db.prepare('SELECT id FROM files').get().id
  const doc = { files: [{ relative_path: 'a.mp4', filename: 'a.mp4', favorite: true, tags: [{ category: 'Brand', name: 'Acme' }] }] }
  const r = await t.post('/api/import/metadata', doc, A)
  assert.equal(r.status, 200)
  assert.equal(r.data.favorites_set, 1)
  const ev = t.db.prepare("SELECT * FROM file_events WHERE file_id=? AND action='metadata_imported'").get(id)
  assert.equal(ev.user_id, adminId)
  assert.equal(ev.actor_label, 'The Admin')
  const actions = t.db.prepare("SELECT action, user_id FROM audit_log WHERE action IN ('export','metadata_import') AND id > ?").all(mark)
  assert.ok(actions.filter((a) => a.action === 'export').length >= 2)
  assert.ok(actions.every((a) => a.user_id === adminId))
  assert.ok(actions.some((a) => a.action === 'metadata_import'))
  // dry run is not audited as an import and writes nothing
  const before = t.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='metadata_import'").get().n
  await t.post('/api/import/metadata?dry_run=1', doc, A)
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='metadata_import'").get().n, before)
})

test('exports never contain credentials', async () => {
  const body = (await t.get('/api/export/metadata?format=json', A)).data
  const s = JSON.stringify(body)
  assert.ok(!/password|token_hash|scrypt\$|mb_session/i.test(s))
})
