import { Router } from 'express'
import { getDb } from '../db/index.js'
import { HttpError } from '../services/errors.js'
import { requireAdmin } from '../middleware/session.js'
import {
  audit, countActiveAdmins, createUser, deleteUserSessions, getUser, publicUser, setPassword, userActor,
  validateDisplayName,
} from '../services/auth.js'

const router = Router()
router.use(requireAdmin)
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

function loadUser(db, id) {
  const u = getUser(db, Number(id))
  if (!u) throw new HttpError(404, 'User not found')
  return u
}

router.get('/', (req, res) => {
  const rows = getDb().prepare(`
    SELECT u.*, (SELECT COUNT(*) FROM files f WHERE f.uploaded_by = u.id AND f.is_missing = 0 AND f.deleted_at IS NULL) AS file_count
    FROM users u ORDER BY u.disabled_at IS NOT NULL, u.display_name COLLATE NOCASE
  `).all()
  res.json({ users: rows.map((u) => ({ ...publicUser(u), file_count: u.file_count })) })
})

router.post('/', wrap(async (req, res) => {
  const db = getDb()
  const { username, display_name, role = 'user', password } = req.body || {}
  const user = await createUser(db, { username, display_name, password, role })
  audit(db, userActor(req.user), 'user_created', { id: user.id, username: user.username, role: user.role })
  res.status(201).json({ user: publicUser(user) })
}))

router.patch('/:id', (req, res) => {
  const db = getDb()
  const target = loadUser(db, req.params.id)
  const { display_name, role, disabled } = req.body || {}
  const changes = {}
  db.transaction(() => {
    if (display_name !== undefined) changes.display_name = validateDisplayName(display_name)
    if (role !== undefined) {
      if (!['admin', 'user'].includes(role)) throw new HttpError(400, "role must be 'admin' or 'user'")
      changes.role = role
    }
    if (disabled !== undefined) {
      if (typeof disabled !== 'boolean') throw new HttpError(400, 'disabled must be a boolean')
      changes.disabled = disabled
    }
    const losesAdmin = !target.disabled_at && target.role === 'admin' && (changes.role === 'user' || changes.disabled === true)
    if (changes.disabled === true && req.user && req.user.id === target.id) throw new HttpError(409, 'You cannot disable your own account')
    if (losesAdmin && countActiveAdmins(db) <= 1) throw new HttpError(409, 'There must be at least one active administrator')

    if (changes.display_name !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(changes.display_name, target.id)
    if (changes.role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(changes.role, target.id)
    if (changes.disabled !== undefined) {
      db.prepare(`UPDATE users SET disabled_at = ${changes.disabled ? "COALESCE(disabled_at, datetime('now'))" : 'NULL'} WHERE id = ?`).run(target.id)
      if (changes.disabled) deleteUserSessions(db, target.id)
    }
    const action = changes.disabled === true && !target.disabled_at ? 'user_disabled' : 'user_updated'
    audit(db, userActor(req.user), action, { id: target.id, username: target.username, ...changes })
  })()
  res.json({ user: publicUser(getUser(db, target.id)) })
})

// Admin reset: sets a new password and signs that user out everywhere (except this very session).
router.post('/:id/password', wrap(async (req, res) => {
  const db = getDb()
  const target = loadUser(db, req.params.id)
  await setPassword(db, target.id, req.body?.password)
  deleteUserSessions(db, target.id, req.user?.id === target.id ? req.sessionId : null)
  audit(db, userActor(req.user), 'user_password_reset', { id: target.id, username: target.username })
  res.json({ ok: true })
}))

export default router
