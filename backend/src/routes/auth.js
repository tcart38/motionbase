import { Router } from 'express'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDb } from '../db/index.js'
import { HttpError } from '../services/errors.js'
import { requireUser } from '../middleware/session.js'
import {
  SESSION_COOKIE, areSignupsEnabled, audit, recordSignup, signupLimited, signupsRequireApproval, clearFailures, clearSessionCookie, countUsers, createSession, createUser,
  deleteSessionByToken, deleteUserSessions, fakeVerify, getUser, getUserByName, isAuthEnabled, parseCookies,
  publicUser, rateLimited, recordFailure, setAuthEnabled, setPassword, setSessionCookie, userActor,
  validateDisplayName, validatePassword, verifyPassword,
} from '../services/auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8'))

const router = Router()
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const BAD = 'Invalid username or password'

function tooMany(res, seconds) {
  res.set('Retry-After', String(seconds))
  return res.status(429).json({ error: 'Too many failed attempts. Try again later.', retry_after: seconds })
}

// Checks credentials with a rate limit; returns the user row or sends the error response (returns null).
async function checkCredentials(req, res, username, password, { action = 'login_failed' } = {}) {
  const db = getDb()
  const name = String(username ?? '').trim().slice(0, 80)
  const wait = rateLimited(name, req.ip)
  if (wait) { tooMany(res, wait); return null }
  const user = typeof password === 'string' && name ? getUserByName(db, name) : null
  const ok = user ? await verifyPassword(password, user.password_hash) : (await fakeVerify(String(password ?? '')), false)
  if (ok && user.pending) {
    clearFailures(name, req.ip)
    res.status(403).json({ error: 'Your account is waiting for admin approval', pending: true })
    return null
  }
  if (!ok || user.disabled_at) {
    recordFailure(name, req.ip)
    audit(db, { user_id: user?.id ?? null, label: null }, action, { username: name, ip: req.ip, reason: user?.disabled_at && ok ? 'disabled' : undefined })
    const again = rateLimited(name, req.ip)
    if (again) tooMany(res, again); else res.status(401).json({ error: BAD })
    return null
  }
  clearFailures(name, req.ip)
  return user
}

function startSession(req, res, user) {
  const token = createSession(getDb(), user.id, req.headers['user-agent'])
  setSessionCookie(req, res, token)
}

// Always public.
router.get('/status', (req, res) => {
  const db = getDb()
  res.json({
    enabled: req.authEnabled,
    setup_required: countUsers(db) === 0,
    user: req.authEnabled ? publicUser(req.user) : null,
    signups_enabled: areSignupsEnabled(db),
    signups_require_approval: signupsRequireApproval(db),
    version,
  })
})

// Who exists, for pickers such as the Library's "Uploaded by" filter. Any signed-in user (or anyone while
// login is off). Includes disabled accounts because they may have uploaded files. No secrets or roles.
router.get('/directory', (req, res) => {
  if (req.authEnabled && !req.user) return res.status(401).json({ error: 'Login required', login_required: true })
  const rows = getDb().prepare('SELECT id, display_name, username FROM users ORDER BY display_name COLLATE NOCASE, id').all()
  res.json({ users: rows })
})

// First run: creates the first admin, turns login on and signs them in.
router.post('/setup', wrap(async (req, res) => {
  const db = getDb()
  if (countUsers(db) > 0) throw new HttpError(409, 'Setup is already done. Use enable to turn login on again.')
  const { username, display_name, password } = req.body || {}
  const user = await createUser(db, { username, display_name, password, role: 'admin' })
  setAuthEnabled(db, true)
  audit(db, userActor(user), 'user_created', { id: user.id, username: user.username, role: 'admin', setup: true })
  audit(db, userActor(user), 'login_enabled')
  startSession(req, res, user)
  audit(db, userActor(user), 'login', { username: user.username })
  res.status(201).json({ user: publicUser(getUser(db, user.id)) })
}))

// Login is off but accounts exist: an admin proves who they are to turn it back on.
router.post('/enable', wrap(async (req, res) => {
  const db = getDb()
  if (isAuthEnabled(db)) throw new HttpError(409, 'Login is already enabled')
  if (countUsers(db) === 0) throw new HttpError(409, 'No accounts exist yet. Use setup.')
  const user = await checkCredentials(req, res, req.body?.username, req.body?.password)
  if (!user) return
  if (user.role !== 'admin') return res.status(403).json({ error: 'Only an administrator can turn login on' })
  setAuthEnabled(db, true)
  audit(db, userActor(user), 'login_enabled')
  startSession(req, res, user)
  audit(db, userActor(user), 'login', { username: user.username })
  res.json({ user: publicUser(getUser(db, user.id)) })
}))

router.post('/login', wrap(async (req, res) => {
  const db = getDb()
  if (!isAuthEnabled(db)) throw new HttpError(409, 'Login is not enabled')
  const user = await checkCredentials(req, res, req.body?.username, req.body?.password)
  if (!user) return
  startSession(req, res, user)
  audit(db, userActor(user), 'login', { username: user.username })
  res.json({ user: publicUser(getUser(db, user.id)) })
}))

// Optional self sign-up. Always creates a normal user (any role in the body is ignored).
router.post('/signup', wrap(async (req, res) => {
  const db = getDb()
  if (!areSignupsEnabled(db)) throw new HttpError(403, 'Sign-ups are not enabled')
  const wait = signupLimited(req.ip)
  if (wait) {
    res.set('Retry-After', String(wait))
    return res.status(429).json({ error: 'Too many sign-ups. Try again later.', retry_after: wait })
  }
  const { username, display_name, password } = req.body || {}
  const pending = signupsRequireApproval(db)
  const user = await createUser(db, { username, display_name, password, role: 'user', pending })
  recordSignup(req.ip)
  audit(db, userActor(user), 'signup', { id: user.id, username: user.username, pending, ip: req.ip })
  if (pending) return res.status(201).json({ pending: true })
  startSession(req, res, user)
  audit(db, userActor(user), 'login', { username: user.username })
  res.status(201).json({ user: publicUser(getUser(db, user.id)) })
}))

router.post('/logout', (req, res) => {
  const db = getDb()
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
  deleteSessionByToken(db, token)
  if (req.user) audit(db, userActor(req.user), 'logout')
  clearSessionCookie(req, res)
  res.json({ ok: true })
})

// Own password. Other sessions of this user are signed out.
router.post('/password', requireUser, wrap(async (req, res) => {
  const db = getDb()
  const { current } = req.body || {}
  const next = req.body?.new ?? req.body?.new_password
  const key = `password:${req.user.username}`
  const wait = rateLimited(key, req.ip)
  if (wait) return tooMany(res, wait)
  if (typeof current !== 'string' || !(await verifyPassword(current, req.user.password_hash))) {
    recordFailure(key, req.ip)
    return res.status(401).json({ error: 'Current password is incorrect' })
  }
  clearFailures(key, req.ip)
  validatePassword(next)
  await setPassword(db, req.user.id, next)
  deleteUserSessions(db, req.user.id, req.sessionId)
  audit(db, userActor(req.user), 'password_changed')
  res.json({ ok: true })
}))

router.patch('/me', requireUser, (req, res) => {
  const db = getDb()
  const display = validateDisplayName(req.body?.display_name)
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display, req.user.id)
  audit(db, userActor(req.user), 'user_updated', { id: req.user.id, display_name: display })
  res.json({ user: publicUser(getUser(db, req.user.id)) })
})

// Admin turns login off (re-enter password). Accounts and sessions are kept but ignored while off.
router.post('/disable', requireUser, wrap(async (req, res) => {
  const db = getDb()
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access required' })
  const key = `disable:${req.user.username}`
  const wait = rateLimited(key, req.ip)
  if (wait) return tooMany(res, wait)
  if (typeof req.body?.password !== 'string' || !(await verifyPassword(req.body.password, req.user.password_hash))) {
    recordFailure(key, req.ip)
    return res.status(401).json({ error: 'Password is incorrect' })
  }
  clearFailures(key, req.ip)
  setAuthEnabled(db, false)
  audit(db, userActor(req.user), 'login_disabled')
  res.json({ enabled: false })
}))

export default router
