// Optional accounts: password hashing, users, sessions, login rate limit and the audit log.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import { HttpError } from './errors.js'

const scrypt = promisify(scryptCb)
const sha256 = (s) => createHash('sha256').update(s).digest('hex')

export const SESSION_COOKIE = 'mb_session'
export const SESSION_DAYS = 30
export const MIN_PASSWORD = 10
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

// ---- passwords -----------------------------------------------------------------

// Stored as scrypt$N$r$p$<salt b64>$<hash b64>; per-user random salt.
export async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored || '').split('$')
  if (alg !== 'scrypt' || !hash) return false
  const want = Buffer.from(hash, 'base64')
  const got = await scrypt(String(password), Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p })
  return got.length === want.length && timingSafeEqual(got, want)
}

// Burns the same CPU time as a real check so unknown usernames are not distinguishable.
let dummyHash
export async function fakeVerify(password) {
  dummyHash ??= await hashPassword('motionbase-dummy-password')
  await verifyPassword(password, dummyHash)
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters`)
  if (pw.length > 200) throw new HttpError(400, 'Password is too long (max 200 characters)')
}

// ---- settings ------------------------------------------------------------------

export function isAuthEnabled(db) {
  return db.prepare("SELECT value FROM settings WHERE key = 'auth_enabled'").get()?.value === 'true'
}

export function setAuthEnabled(db, enabled) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('auth_enabled', ?)").run(enabled ? 'true' : 'false')
}

export function areSignupsEnabled(db) {
  return isAuthEnabled(db) && db.prepare("SELECT value FROM settings WHERE key = 'signups_enabled'").get()?.value === 'true'
}

// Defaults to true (safe) unless an admin explicitly turned it off.
export function signupsRequireApproval(db) {
  return db.prepare("SELECT value FROM settings WHERE key = 'signups_require_approval'").get()?.value !== 'false'
}

// ---- audit ---------------------------------------------------------------------

// by: { user_id, label } (or null for system/unknown)
export function audit(db, by, action, detail = null) {
  db.prepare('INSERT INTO audit_log (user_id, actor_label, action, detail_json) VALUES (?, ?, ?, ?)')
    .run(by?.user_id ?? null, by?.label ?? null, action, detail ? JSON.stringify(detail) : null)
}

export const userActor = (user) => (user ? { user_id: user.id, label: user.display_name } : { user_id: null, label: null })

export function listAudit(db, { limit, before } = {}) {
  const lim = Math.min(500, Math.max(1, parseInt(limit, 10) || 100))
  const b = parseInt(before, 10)
  const rows = db.prepare(`
    SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    ${b > 0 ? 'WHERE a.id < ?' : ''} ORDER BY a.id DESC LIMIT ?
  `).all(...(b > 0 ? [b] : []), lim + 1)
  const page = rows.slice(0, lim)
  return {
    entries: page.map((r) => ({
      id: r.id, user_id: r.user_id, username: r.username ?? null, actor_label: r.actor_label, action: r.action,
      detail: r.detail_json ? JSON.parse(r.detail_json) : null, created_at: r.created_at,
    })),
    next_before: rows.length > lim ? page.at(-1).id : null,
  }
}

// ---- users ---------------------------------------------------------------------

export function publicUser(u) {
  if (!u) return null
  return {
    id: u.id, username: u.username, display_name: u.display_name, role: u.role,
    disabled: !!u.disabled_at, pending: !!u.pending, created_at: u.created_at, last_login_at: u.last_login_at,
  }
}

export const getUser = (db, id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id)
export const getUserByName = (db, username) => db.prepare('SELECT * FROM users WHERE username = ?').get(String(username ?? '').trim())
export const countUsers = (db) => db.prepare('SELECT COUNT(*) AS n FROM users').get().n
export const countActiveAdmins = (db) =>
  db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL AND pending = 0").get().n

export function validateUsername(username) {
  const u = String(username ?? '').trim()
  if (!/^[A-Za-z0-9._@-]{2,40}$/.test(u)) {
    throw new HttpError(400, 'Username must be 2-40 characters: letters, numbers, . _ - @')
  }
  return u
}

export function validateDisplayName(name, fallback) {
  const d = String(name ?? '').trim() || fallback
  if (!d) throw new HttpError(400, 'display_name is required')
  if (d.length > 80) throw new HttpError(400, 'display_name is too long (max 80 characters)')
  return d
}

export async function createUser(db, { username, display_name, password, role = 'user', pending = false }) {
  const uname = validateUsername(username)
  const display = validateDisplayName(display_name, uname)
  if (!['admin', 'user'].includes(role)) throw new HttpError(400, "role must be 'admin' or 'user'")
  validatePassword(password)
  if (getUserByName(db, uname)) throw new HttpError(409, 'That username is already taken')
  const hash = await hashPassword(password)
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO users (username, display_name, password_hash, role, pending) VALUES (?, ?, ?, ?, ?)'
  ).run(uname, display, hash, role, pending ? 1 : 0)
  return getUser(db, lastInsertRowid)
}

export async function setPassword(db, userId, password) {
  validatePassword(password)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), userId)
}

// ---- sessions ------------------------------------------------------------------

const addDays = (d, n) => new Date(d.getTime() + n * 86400000).toISOString()

// Random 32-byte token; only its sha256 is stored. Returns the plaintext (cookie value).
export function createSession(db, userId, userAgent) {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString())
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sha256(token), userId, now.toISOString(), addDays(now, SESSION_DAYS), now.toISOString(), String(userAgent || '').slice(0, 200) || null)
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userId)
  return token
}

// Returns { user, sessionId, refreshed } or null. Slides the 30-day expiry (at most every 5 minutes).
export function resolveSession(db, token) {
  if (!token) return null
  const row = db.prepare(`
    SELECT s.id AS sid, s.expires_at, s.last_seen_at, u.*
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?
  `).get(sha256(token))
  const now = new Date()
  if (!row || row.expires_at <= now.toISOString() || row.disabled_at || row.pending) return null
  let refreshed = false
  if (now.getTime() - new Date(row.last_seen_at).getTime() > 5 * 60000) {
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(now.toISOString(), addDays(now, SESSION_DAYS), row.sid)
    refreshed = true
  }
  const { sid, expires_at, last_seen_at, ...user } = row
  return { user, sessionId: sid, refreshed }
}

export const deleteSessionByToken = (db, token) =>
  token && db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))

export function deleteUserSessions(db, userId, exceptSessionId = null) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?').run(userId, exceptSessionId)
}

export function parseCookies(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()) } catch { /* ignore */ }
    }
  }
  return out
}

export const isHttps = (req) => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'

export function setSessionCookie(req, res, token) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isHttps(req) ? '; Secure' : ''}`)
}
export function clearSessionCookie(req, res) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`)
}

// ---- login rate limit (in memory) ------------------------------------------------

const WINDOW_MS = 15 * 60000
const MAX_FAILURES = 5
const failures = new Map() // key -> [timestamps]

const key = (name, ip) => `${String(name).toLowerCase()}|${ip}`

// Returns seconds to wait, or 0 when allowed.
export function rateLimited(name, ip) {
  const k = key(name, ip)
  const now = Date.now()
  const recent = (failures.get(k) || []).filter((t) => now - t < WINDOW_MS)
  if (recent.length) failures.set(k, recent); else failures.delete(k)
  return recent.length >= MAX_FAILURES ? Math.ceil((recent[0] + WINDOW_MS - now) / 1000) : 0
}
export function recordFailure(name, ip) {
  const k = key(name, ip)
  failures.set(k, [...(failures.get(k) || []), Date.now()])
}
export const clearFailures = (name, ip) => failures.delete(key(name, ip))
export const resetRateLimits = () => failures.clear()

// ---- sign-up rate limit (in memory) ----------------------------------------------

export const SIGNUP_PER_IP = 5 // per hour
export const SIGNUP_GLOBAL = 50 // per 24 hours
const HOUR = 3600000
const DAY = 24 * HOUR
let signupsByIp = new Map() // ip -> [timestamps]
let signupsAll = []

// Returns seconds to wait, or 0 when allowed.
export function signupLimited(ip) {
  const now = Date.now()
  signupsAll = signupsAll.filter((t) => now - t < DAY)
  if (signupsAll.length >= SIGNUP_GLOBAL) return Math.ceil((signupsAll[0] + DAY - now) / 1000)
  const recent = (signupsByIp.get(ip) || []).filter((t) => now - t < HOUR)
  if (recent.length) signupsByIp.set(ip, recent); else signupsByIp.delete(ip)
  return recent.length >= SIGNUP_PER_IP ? Math.ceil((recent[0] + HOUR - now) / 1000) : 0
}
export function recordSignup(ip) {
  const now = Date.now()
  signupsAll.push(now)
  signupsByIp.set(ip, [...(signupsByIp.get(ip) || []), now])
}
export function resetSignupLimits() { signupsByIp = new Map(); signupsAll = [] }
