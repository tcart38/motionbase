import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { startTestServer } from './helpers.js'
import { applyBaseSchema } from '../src/db/schema.js'
import { migrations, runMigrations } from '../src/db/migrations.js'

let t
let admin
const PW = 'correct horse battery'
before(async () => {
  t = await startTestServer()
  const r = await t.post('/api/auth/setup', { username: 'root', display_name: 'Root', password: PW })
  admin = { Cookie: cookieOf(r).split(';')[0] }
})
after(() => t.close())
beforeEach(async () => {
  const a = await import('../src/services/auth.js')
  a.resetRateLimits(); a.resetSignupLimits()
})

const cookieOf = (r) => (r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie')]).find((x) => x?.startsWith('mb_session='))
const setSignups = (signups_enabled, signups_require_approval) =>
  fetch(t.baseUrl + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...admin }, body: JSON.stringify({ signups_enabled, signups_require_approval }) })
const audits = (action) => t.db.prepare('SELECT * FROM audit_log WHERE action = ?').all(action)

test('sign-ups are off by default: status says so and signup is 403', async () => {
  const st = (await t.get('/api/auth/status')).data
  assert.equal(st.signups_enabled, false)
  assert.equal(st.signups_require_approval, true)
  const r = await t.post('/api/auth/signup', { username: 'eve', display_name: 'Eve', password: PW })
  assert.equal(r.status, 403)
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'eve'").get().n, 0)
})

test('settings are admin-only booleans', async () => {
  assert.equal((await t.api('PUT', '/api/settings', { signups_enabled: true })).status, 401)
  const bad = await fetch(t.baseUrl + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...admin }, body: '{"signups_enabled":"yes"}' })
  assert.equal(bad.status, 400)
  assert.equal((await setSignups(true, true)).status, 200)
  const st = (await t.get('/api/auth/status')).data
  assert.equal(st.signups_enabled, true)
  assert.equal(st.signups_require_approval, true)
  assert.deepEqual(Object.keys(st).sort(), ['enabled', 'setup_required', 'signups_enabled', 'signups_require_approval', 'user', 'version'])
})

test('approval flow: pending cannot sign in, approve then login, reject keeps disabled', async () => {
  await setSignups(true, true)
  const r = await t.post('/api/auth/signup', { username: 'Ann', display_name: 'Ann A', password: PW, role: 'admin' })
  assert.equal(r.status, 201)
  assert.deepEqual(r.data, { pending: true })
  assert.equal(cookieOf(r), undefined)
  const row = t.db.prepare("SELECT * FROM users WHERE username = 'Ann'").get()
  assert.equal(row.role, 'user')
  assert.equal(row.pending, 1)
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(row.id).n, 0)
  assert.equal(audits('signup').at(-1).detail_json.includes('"pending":true'), true)

  const wrong = await t.post('/api/auth/login', { username: 'ann', password: 'nope nope nope' })
  assert.equal(wrong.status, 401)
  assert.equal(wrong.data.pending, undefined)
  const pend = await t.post('/api/auth/login', { username: 'ann', password: PW })
  assert.equal(pend.status, 403)
  assert.equal(pend.data.pending, true)
  assert.equal(pend.data.error, 'Your account is waiting for admin approval')
  assert.equal(cookieOf(pend), undefined)

  const list = (await t.get('/api/users', admin)).data
  assert.equal(list.pending_count, 1)
  assert.equal(list.users.find((u) => u.username === 'Ann').pending, true)
  assert.equal((await t.patch(`/api/users/${row.id}`, { disabled: false }, admin)).status, 409)
  assert.equal((await t.post(`/api/users/${row.id}/approve`, {})).status, 401)

  const ok = await t.post(`/api/users/${row.id}/approve`, {}, admin)
  assert.equal(ok.status, 200)
  assert.equal(ok.data.user.pending, false)
  assert.equal((await t.post(`/api/users/${row.id}/approve`, {}, admin)).status, 409)
  assert.equal(audits('signup_approved').length, 1)
  assert.equal((await t.get('/api/users', admin)).data.pending_count, 0)
  const li = await t.post('/api/auth/login', { username: 'ann', password: PW })
  assert.equal(li.status, 200)
  assert.equal(li.data.user.role, 'user')
  const ck = { Cookie: cookieOf(li).split(';')[0] }
  assert.equal((await t.get('/api/users', ck)).status, 403)

  await t.post('/api/auth/signup', { username: 'bob', display_name: 'Bob', password: PW })
  const bob = t.db.prepare("SELECT * FROM users WHERE username = 'bob'").get()
  const rej = await t.post(`/api/users/${bob.id}/reject`, {}, admin)
  assert.equal(rej.status, 200)
  assert.equal(rej.data.user.disabled, true)
  assert.equal(rej.data.user.pending, false)
  assert.ok(t.db.prepare('SELECT 1 FROM users WHERE id = ?').get(bob.id))
  assert.equal(audits('signup_rejected').length, 1)
  assert.equal((await t.post('/api/auth/login', { username: 'bob', password: PW })).status, 401)
  assert.equal((await t.post(`/api/users/${bob.id}/reject`, {}, admin)).status, 409)
  assert.equal((await t.post('/api/users/9999/approve', {}, admin)).status, 404)
})

test('pending users have no agent tokens that work', async () => {
  const { createToken, authenticate } = await import('../src/services/tokens.js')
  await t.post('/api/auth/signup', { username: 'tok', display_name: 'Tok', password: PW })
  const u = t.db.prepare("SELECT id FROM users WHERE username = 'tok'").get()
  const made = createToken(t.db, 'sneaky', u.id)
  assert.equal(authenticate(t.db, made.token), null)
  t.db.prepare('UPDATE users SET pending = 0 WHERE id = ?').run(u.id)
  assert.ok(authenticate(t.db, made.token))
})

test('without approval: signs in right away as a normal user', async () => {
  await setSignups(true, false)
  assert.equal((await t.get('/api/auth/status')).data.signups_require_approval, false)
  const r = await t.post('/api/auth/signup', { username: 'carl', display_name: 'Carl', password: PW, role: 'admin' })
  assert.equal(r.status, 201)
  assert.equal(r.data.user.role, 'user')
  assert.equal(r.data.user.pending, false)
  const ck = { Cookie: cookieOf(r).split(';')[0] }
  assert.equal((await t.get('/api/auth/status', ck)).data.user.username, 'carl')
  assert.equal((await t.get('/api/users', ck)).status, 403)
  assert.equal((await t.api('PUT', '/api/settings', { signups_enabled: false }, ck)).status, 403)
  assert.ok(audits('signup').some((a) => a.detail_json.includes('"carl"')))
})

test('validation: duplicate username 409 (case-insensitive), password and name rules', async () => {
  await setSignups(true, false)
  assert.equal((await t.post('/api/auth/signup', { username: 'ROOT', display_name: 'x', password: PW })).status, 409)
  assert.equal((await t.post('/api/auth/signup', { username: 'dave', display_name: 'D', password: 'short' })).status, 400)
  assert.equal((await t.post('/api/auth/signup', { username: 'dave', display_name: 'D', password: 'x'.repeat(201) })).status, 400)
  assert.equal((await t.post('/api/auth/signup', { username: 'a b', display_name: 'D', password: PW })).status, 400)
  assert.equal((await t.post('/api/auth/signup', { username: 'dave', display_name: 'D'.repeat(81), password: PW })).status, 400)
  const ok = await t.post('/api/auth/signup', { username: 'dave', password: PW })
  assert.equal(ok.status, 201)
  assert.equal(ok.data.user.display_name, 'dave')
  assert.equal((await t.post('/api/auth/signup', { username: 'Dave', display_name: 'D', password: PW })).status, 409)
})

test('signup is 403 when login is on but sign-ups off, and requires login enabled at all', async () => {
  await setSignups(false, true)
  assert.equal((await t.post('/api/auth/signup', { username: 'zed', display_name: 'Z', password: PW })).status, 403)
})

test('rate limit: 5 per hour per IP, then 429 with Retry-After; global daily cap', async () => {
  await setSignups(true, true)
  for (let i = 0; i < 5; i++) assert.equal((await t.post('/api/auth/signup', { username: `rl${i}`, display_name: 'R', password: PW })).status, 201)
  const r = await t.post('/api/auth/signup', { username: 'rl5', display_name: 'R', password: PW })
  assert.equal(r.status, 429)
  assert.ok(Number(r.headers.get('retry-after')) > 0)
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'rl5'").get().n, 0)

  const a = await import('../src/services/auth.js')
  a.resetSignupLimits()
  for (let i = 0; i < a.SIGNUP_GLOBAL; i++) a.recordSignup(`10.0.${i}.1`)
  const g = await t.post('/api/auth/signup', { username: 'global', display_name: 'G', password: PW })
  assert.equal(g.status, 429)
  assert.ok(Number(g.headers.get('retry-after')) > 0)
})

test('migration 5 keeps existing users approved and sign-ups off', () => {
  const db = new Database(':memory:')
  applyBaseSchema(db)
  for (const m of migrations.filter((x) => x.version <= 4)) db.transaction(() => { m.up(db); db.pragma(`user_version = ${m.version}`) })()
  db.prepare("INSERT INTO users (username, display_name, password_hash, role) VALUES ('old', 'Old', 'h', 'admin')").run()
  runMigrations(db, { backup: false })
  assert.equal(db.pragma('user_version', { simple: true }), 5)
  const u = db.prepare("SELECT * FROM users WHERE username = 'old'").get()
  assert.equal(u.pending, 0)
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'signups_enabled'").get().value, 'false')
  db.close()
})
