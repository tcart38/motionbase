import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { startTestServer, addFile } from './helpers.js'

let t
const PW = 'correct horse battery'
before(async () => { t = await startTestServer() })
after(() => t.close())
beforeEach(async () => (await import('../src/services/auth.js')).resetRateLimits())

const cookieOf = (r) => {
  const sc = r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie')]
  const c = sc.find((x) => x?.startsWith('mb_session='))
  return c ? { raw: c, header: c.split(';')[0] } : null
}
const as = (c) => ({ Cookie: c.header })
const login = async (username, password = PW) => {
  const r = await t.post('/api/auth/login', { username, password })
  return { r, c: cookieOf(r) }
}

test('login off: nothing changes, open access, accounts are not required', async () => {
  const st = (await t.get('/api/auth/status')).data
  assert.deepEqual({ enabled: st.enabled, setup_required: st.setup_required, user: st.user }, { enabled: false, setup_required: true, user: null })
  assert.ok(st.version)
  assert.equal((await t.get('/api/files')).status, 200)
  assert.equal((await t.get('/api/users')).status, 200) // everyone is effectively admin while login is off
  assert.equal((await t.put?.('/api/settings', { scan_interval: 30 }) ?? await fetch(t.baseUrl + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"scan_interval":30}' })).status, 200)
  const tok = (await t.post('/api/tokens', { name: 'before-login' })).data
  assert.equal(tok.user_id, null)
  assert.equal(tok.owner, null)
  assert.equal((await t.post('/api/auth/login', { username: 'x', password: 'y' })).status, 409)
  assert.equal((await t.get('/api/auth/status')).data.setup_required, true)
  assert.equal((await t.post('/api/auth/password', { current: 'a', new: 'b' })).status, 401)
  const mig = t.db.prepare("SELECT value FROM settings WHERE key = 'auth_enabled'").get()
  assert.equal(mig.value, 'false')
})

test('setup validates, creates the admin, turns login on and signs in', async () => {
  assert.equal((await t.post('/api/auth/setup', { username: 'admin', password: 'short' })).status, 400)
  assert.equal((await t.post('/api/auth/setup', { username: 'a b', password: PW })).status, 400)
  const r = await t.post('/api/auth/setup', { username: 'Admin', display_name: 'The Admin', password: PW })
  assert.equal(r.status, 201)
  assert.equal(r.data.user.role, 'admin')
  assert.equal(r.data.user.display_name, 'The Admin')
  assert.equal(r.data.user.password_hash, undefined)
  const c = cookieOf(r)
  assert.match(c.raw, /HttpOnly/)
  assert.match(c.raw, /SameSite=Lax/)
  assert.match(c.raw, /Max-Age=2592000/)
  assert.doesNotMatch(c.raw, /Secure/)

  const st = (await t.get('/api/auth/status', as(c))).data
  assert.equal(st.enabled, true)
  assert.equal(st.setup_required, false)
  assert.equal(st.user.username, 'Admin')
  assert.equal((await t.get('/api/auth/status')).data.user, null)
  assert.equal((await t.post('/api/auth/setup', { username: 'other', password: PW })).status, 409)

  // storage: password is hashed, session token only stored as a hash
  const row = t.db.prepare('SELECT * FROM users WHERE username = ?').get('admin')
  assert.match(row.password_hash, /^scrypt\$16384\$8\$1\$/)
  assert.ok(!row.password_hash.includes(PW))
  const token = c.header.split('=')[1]
  const s = t.db.prepare('SELECT * FROM sessions').get()
  assert.notEqual(s.token_hash, token)
  assert.equal(s.token_hash.length, 64)
  const h2 = (await import('../src/services/auth.js')).hashPassword
  assert.notEqual(await h2(PW), await h2(PW)) // per-user salt
  const audits = t.db.prepare('SELECT action FROM audit_log').all().map((a) => a.action)
  assert.ok(['user_created', 'login_enabled', 'login'].every((a) => audits.includes(a)))
})

test('Secure cookie when the request is https behind a proxy', async () => {
  const r = await t.post('/api/auth/login', { username: 'admin', password: PW }, { 'X-Forwarded-Proto': 'https' })
  assert.match(cookieOf(r).raw, /; Secure/)
})

test('with login on: 401 without a session; bearer-token agent API and public paths still work', async () => {
  for (const u of ['/api/files', '/api/tags', '/api/settings', '/api/tokens', '/api/users', '/api/folders']) {
    const r = await t.get(u)
    assert.equal(r.status, 401, u)
    assert.equal(r.data.login_required, true)
  }
  assert.equal((await t.get('/thumbnails/1.jpg')).status, 401)
  assert.equal((await t.get('/api/health')).status, 200)
  assert.equal((await t.get('/api/agent/v1/')).status, 200)
  // agent API: bearer only, with or without a browser session
  assert.equal((await t.get('/api/agent/v1/status')).status, 401)
  const { c } = await login('admin')
  const tok = (await t.post('/api/tokens', { name: 'owner-test' }, as(c))).data
  assert.ok(tok.user_id)
  assert.equal(tok.owner.username, 'Admin')
  const bearer = { Authorization: `Bearer ${tok.token}` }
  assert.equal((await t.get('/api/agent/v1/status', bearer)).status, 200)
  assert.equal((await t.get('/api/agent/v1/status', as(c))).status, 401) // a cookie is not an agent credential
  // /mcp keeps bearer auth: no token -> its own 401 (not login_required)
  const mcp = await t.post('/mcp', {})
  assert.equal(mcp.status, 401)
  assert.equal(mcp.data.login_required, undefined)
})

test('login, logout, wrong passwords are indistinguishable, bad cookies rejected', async () => {
  const bad1 = await t.post('/api/auth/login', { username: 'admin', password: 'wrong-password-1' })
  const bad2 = await t.post('/api/auth/login', { username: 'nobody', password: 'wrong-password-1' })
  assert.equal(bad1.status, 401)
  assert.deepEqual(bad1.data, bad2.data)
  assert.equal(bad1.data.error, 'Invalid username or password')

  const { r, c } = await login('ADMIN') // case-insensitive username
  assert.equal(r.status, 200)
  assert.equal((await t.get('/api/files', as(c))).status, 200)
  assert.equal((await t.get('/api/files', { Cookie: 'mb_session=garbage' })).status, 401)

  const out = await t.post('/api/auth/logout', {}, as(c))
  assert.equal(out.status, 200)
  assert.match(cookieOf(out).raw, /Max-Age=0/)
  assert.equal((await t.get('/api/files', as(c))).status, 401)
  const actions = t.db.prepare('SELECT action FROM audit_log').all().map((a) => a.action)
  assert.ok(actions.includes('login_failed') && actions.includes('logout'))
})

test('sessions expire and slide', async () => {
  const { c } = await login('admin')
  const token = c.header.split('=')[1]
  const row = () => t.db.prepare('SELECT * FROM sessions ORDER BY id DESC').get()
  const id = row().id
  // last seen long ago -> expiry slides forward to ~30 days from now and the cookie is refreshed
  const old = new Date(Date.now() - 3600_000).toISOString()
  t.db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(old, new Date(Date.now() + 86400_000).toISOString(), id)
  const r = await t.get('/api/files', as(c))
  assert.equal(r.status, 200)
  assert.ok(cookieOf(r))
  const days = (new Date(row().expires_at) - Date.now()) / 86400_000
  assert.ok(days > 29.9 && days <= 30)
  // expired
  t.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), id)
  assert.equal((await t.get('/api/files', as(c))).status, 401)
  assert.ok(token)
})

test('login rate limit: 5 failures -> 429 with Retry-After, per username', async () => {
  for (let i = 0; i < 4; i++) assert.equal((await t.post('/api/auth/login', { username: 'ratelimited', password: 'nope-nope-nope' })).status, 401)
  const fifth = await t.post('/api/auth/login', { username: 'ratelimited', password: 'nope-nope-nope' })
  assert.equal(fifth.status, 429)
  assert.ok(Number(fifth.headers.get('retry-after')) > 0)
  assert.equal((await t.post('/api/auth/login', { username: 'ratelimited', password: 'nope-nope-nope' })).status, 429)
  // another username is unaffected, and so is the real admin
  assert.equal((await t.post('/api/auth/login', { username: 'other-name', password: 'x' })).status, 401)
  assert.equal((await t.post('/api/auth/login', { username: 'admin', password: PW })).status, 200)
})

test('CSRF: cross-origin and non-JSON writes with a session cookie are refused', async () => {
  const { c } = await login('admin')
  const host = new URL(t.baseUrl).host
  const ok = await t.post('/api/tokens', { name: 'csrf-ok' }, { ...as(c), Origin: `http://${host}` })
  assert.equal(ok.status, 201)
  const evil = await t.post('/api/tokens', { name: 'csrf' }, { ...as(c), Origin: 'http://evil.example' })
  assert.equal(evil.status, 403)
  const nullOrigin = await t.post('/api/tokens', { name: 'csrf' }, { ...as(c), Origin: 'null' })
  assert.equal(nullOrigin.status, 403)
  const form = await fetch(t.baseUrl + '/api/tokens', { method: 'POST', headers: { ...as(c), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=x' })
  assert.equal(form.status, 403)
  const login403 = await t.post('/api/auth/login', { username: 'admin', password: PW }, { Origin: 'http://evil.example' })
  assert.equal(login403.status, 403)
})

test('users: create, roles, guards, password reset, disabling', async () => {
  const { c: admin } = await login('admin')
  const A = as(admin)
  assert.equal((await t.post('/api/users', { username: 'bob', password: 'short' }, A)).status, 400)
  const created = await t.post('/api/users', { username: 'bob', display_name: 'Bob', role: 'user', password: PW }, A)
  assert.equal(created.status, 201)
  assert.equal(created.data.user.role, 'user')
  assert.equal((await t.post('/api/users', { username: 'BOB', password: PW }, A)).status, 409)
  const bobId = created.data.user.id

  const list = (await t.get('/api/users', A)).data.users
  assert.equal(list.length, 2)
  assert.ok(list.every((u) => 'file_count' in u && 'last_login_at' in u && u.password_hash === undefined))

  // a normal user: everyday things work, admin routes are 403
  const { c: bob } = await login('bob')
  const B = as(bob)
  assert.equal((await t.get('/api/files', B)).status, 200)
  const own = (await t.post('/api/tokens', { name: 'bobs agent' }, B)).data
  assert.equal(own.owner.display_name, 'Bob')
  for (const [m, u, b] of [
    ['get', '/api/users'], ['post', '/api/users', { username: 'zed', password: PW }], ['patch', `/api/users/${bobId}`, { role: 'admin' }],
    ['post', `/api/users/${bobId}/password`, { password: PW }], ['get', '/api/admin/audit'],
    ['post', '/api/files/purge', { all: true }], ['post', '/api/activity/1/revert', {}],
    ['post', '/api/cookies', { content: 'x' }], ['post', '/api/folders/import-from-disk', {}],
    ['post', '/api/auth/disable', { password: PW }],
  ]) {
    const r = m === 'get' ? await t.get(u, B) : await t[m](u, b, B)
    assert.equal(r.status, 403, `${m} ${u}`)
  }
  assert.equal((await fetch(t.baseUrl + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...B }, body: '{"scan_interval":30}' })).status, 403)
  assert.equal((await t.get('/api/settings', B)).status, 200)

  // tokens: users only see/revoke their own; admin sees everyone's with owner
  const adminTok = (await t.post('/api/tokens', { name: 'admins agent' }, A)).data
  const bobList = (await t.get('/api/tokens', B)).data
  assert.ok(bobList.length && bobList.every((x) => x.user_id === bobId))
  assert.equal((await t.del(`/api/tokens/${adminTok.id}`, B)).status, 404)
  const adminList = (await t.get('/api/tokens', A)).data
  assert.ok(adminList.some((x) => x.id === own.id && x.owner.username === 'bob'))
  assert.ok(adminList.some((x) => x.id === adminTok.id))
  assert.equal((await t.del(`/api/tokens/${own.id}`, A)).status, 200)

  // admin reset signs the user out and old password stops working
  assert.equal((await t.post(`/api/users/${bobId}/password`, { password: 'a brand new password' }, A)).status, 200)
  assert.equal((await t.get('/api/files', B)).status, 401)
  assert.equal((await login('bob')).r.status, 401)
  assert.equal((await login('bob', 'a brand new password')).r.status, 200)

  // disabling: cannot sign in, session dies, agent tokens of that user stop working
  const { c: bob2 } = await login('bob', 'a brand new password')
  const tok = (await t.post('/api/tokens', { name: 'bob tok2' }, as(bob2))).data
  assert.equal((await t.get('/api/agent/v1/status', { Authorization: `Bearer ${tok.token}` })).status, 200)
  const dis = await t.patch(`/api/users/${bobId}`, { disabled: true }, A)
  assert.equal(dis.data.user.disabled, true)
  assert.equal((await t.get('/api/files', as(bob2))).status, 401)
  assert.equal((await login('bob', 'a brand new password')).r.status, 401)
  assert.equal((await t.get('/api/agent/v1/status', { Authorization: `Bearer ${tok.token}` })).status, 401)
  await t.patch(`/api/users/${bobId}`, { disabled: false }, A)
  assert.equal((await login('bob', 'a brand new password')).r.status, 200)
  assert.equal((await t.get('/api/agent/v1/status', { Authorization: `Bearer ${tok.token}` })).status, 200)

  const audits = (await t.get('/api/admin/audit?limit=500', A)).data
  const acts = audits.entries.map((e) => e.action)
  for (const a of ['user_created', 'user_disabled', 'user_updated', 'user_password_reset', 'token_created', 'token_revoked', 'login', 'login_failed']) {
    assert.ok(acts.includes(a), a)
  }
  assert.ok(audits.entries.every((e) => e.created_at))
  const page = (await t.get('/api/admin/audit?limit=2', A)).data
  assert.equal(page.entries.length, 2)
  assert.ok(page.next_before)
  assert.ok((await t.get(`/api/admin/audit?limit=2&before=${page.next_before}`, A)).data.entries.every((e) => e.id < page.next_before))
})

test('last-admin and self-disable guards', async () => {
  const { c: admin } = await login('admin')
  const A = as(admin)
  const me = (await t.get('/api/auth/status', A)).data.user
  assert.equal((await t.patch(`/api/users/${me.id}`, { disabled: true }, A)).status, 409)
  assert.equal((await t.patch(`/api/users/${me.id}`, { role: 'user' }, A)).status, 409)
  // with a second admin, demoting the first is fine; then the remaining one is protected
  const second = (await t.post('/api/users', { username: 'second', role: 'admin', password: PW }, A)).data.user
  assert.equal((await t.patch(`/api/users/${second.id}`, { disabled: true }, A)).data.user.disabled, true)
  assert.equal((await t.patch(`/api/users/${me.id}`, { role: 'user' }, A)).status, 409) // second is disabled -> admin is the last active
  await t.patch(`/api/users/${second.id}`, { disabled: false }, A)
  const { c: sec } = await login('second')
  assert.equal((await t.patch(`/api/users/${me.id}`, { role: 'user' }, as(sec))).status, 200)
  assert.equal((await t.patch(`/api/users/${me.id}`, { role: 'admin' }, as(sec))).status, 200)
  assert.equal((await t.patch(`/api/users/${second.id}`, { role: 'user', disabled: true }, A)).status, 200)
  assert.equal((await t.patch('/api/users/9999', { role: 'user' }, A)).status, 404)
})

test('own password change signs out other sessions; display name editable', async () => {
  const { c: one } = await login('admin')
  const { c: two } = await login('admin')
  assert.equal((await t.post('/api/auth/password', { current: 'wrong password', new: 'another long password' }, as(one))).status, 401)
  assert.equal((await t.post('/api/auth/password', { current: PW, new: 'short' }, as(one))).status, 400)
  assert.equal((await t.post('/api/auth/password', { current: PW, new: 'another long password' }, as(one))).status, 200)
  assert.equal((await t.get('/api/files', as(one))).status, 200)
  assert.equal((await t.get('/api/files', as(two))).status, 401)
  const me = await t.patch('/api/auth/me', { display_name: 'Renamed' }, as(one))
  assert.equal(me.data.user.display_name, 'Renamed')
  assert.equal((await t.patch('/api/auth/me', { display_name: ' ' }, as(one))).status, 400)
  await t.post('/api/auth/password', { current: 'another long password', new: PW }, as(one))
})

test('disable login (password re-entry), enable again with admin credentials, CLI recovery', async () => {
  const { c: admin } = await login('admin')
  const A = as(admin)
  assert.equal((await t.post('/api/auth/disable', { password: 'nope' }, A)).status, 401)
  assert.equal((await t.post('/api/auth/disable', { password: PW }, A)).data.enabled, false)

  // login is off: open again, session ignored, setup not offered (users exist), tokens unowned
  const st = (await t.get('/api/auth/status', A)).data
  assert.deepEqual({ e: st.enabled, s: st.setup_required, u: st.user }, { e: false, s: false, u: null })
  assert.equal((await t.get('/api/files')).status, 200)
  assert.equal((await t.post('/api/auth/setup', { username: 'x1', password: PW })).status, 409)
  assert.equal((await t.post('/api/tokens', { name: 'off' })).data.user_id, null)

  // enable needs admin credentials
  assert.equal((await t.post('/api/auth/enable', { username: 'admin', password: 'wrong wrong wrong' })).status, 401)
  assert.equal((await t.post('/api/auth/enable', { username: 'second', password: PW })).status, 401) // disabled account
  assert.equal((await t.post('/api/auth/enable', { username: 'bob', password: 'a brand new password' })).status, 403) // not an admin
  assert.equal((await t.get('/api/files')).status, 200)
  const en = await t.post('/api/auth/enable', { username: 'admin', password: PW })
  assert.equal(en.status, 200)
  assert.ok(cookieOf(en))
  assert.equal((await t.get('/api/files')).status, 401)
  assert.equal((await t.post('/api/auth/enable', { username: 'admin', password: PW })).status, 409)

  // CLI: reset a password and turn login off, against the same data dir
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/cli/reset-password.js')
  const env = { ...process.env, DATA_DIR: t.dataDir }
  const bad = spawnSync(process.execPath, [cli, 'admin', 'short'], { env, encoding: 'utf8' })
  assert.notEqual(bad.status, 0)
  const nouser = spawnSync(process.execPath, [cli, 'ghost', 'long enough password'], { env, encoding: 'utf8' })
  assert.notEqual(nouser.status, 0)
  const res = spawnSync(process.execPath, [cli, 'admin', 'recovered password!', '--disable-login'], { env, encoding: 'utf8' })
  assert.equal(res.status, 0, res.stderr)
  assert.equal((await t.get('/api/files')).status, 200) // login now off
  assert.equal((await t.post('/api/auth/enable', { username: 'admin', password: 'recovered password!' })).status, 200)
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE actor_label = 'CLI'").get().n, 2)
})
