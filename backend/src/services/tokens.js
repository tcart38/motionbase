import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { config } from '../config.js'

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

// Tokens look like mb_<43 url-safe chars>. Only the sha256 is stored; the plaintext
// is returned exactly once, at creation.
export function createToken(db, name, userId = null) {
  const label = String(name || '').trim()
  if (!label) throw Object.assign(new Error('name is required'), { status: 400 })
  const token = 'mb_' + randomBytes(32).toString('base64url')
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO api_tokens (name, token_hash, token_prefix, user_id) VALUES (?, ?, ?, ?)'
  ).run(label.slice(0, 80), sha256(token), token.slice(0, 7), userId)
  return { ...getToken(db, lastInsertRowid), token }
}

const TOKEN_SELECT = `
  SELECT t.id, t.name, t.token_prefix, t.created_at, t.last_used_at, t.revoked_at, t.user_id,
         u.username AS owner_username, u.display_name AS owner_display_name
  FROM api_tokens t LEFT JOIN users u ON u.id = t.user_id`

function shape(r) {
  if (!r) return r
  const { owner_username, owner_display_name, ...t } = r
  return { ...t, owner: t.user_id ? { id: t.user_id, username: owner_username, display_name: owner_display_name } : null }
}

export function getToken(db, id) {
  return shape(db.prepare(`${TOKEN_SELECT} WHERE t.id = ?`).get(id))
}

// userId given -> only that user's tokens; otherwise every token (owner included).
export function listTokens(db, { userId } = {}) {
  const rows = userId != null
    ? db.prepare(`${TOKEN_SELECT} WHERE t.user_id = ? ORDER BY t.id DESC`).all(userId)
    : db.prepare(`${TOKEN_SELECT} ORDER BY t.id DESC`).all()
  return rows.map(shape)
}

// userId given -> only if the token belongs to that user.
export function revokeToken(db, id, { userId } = {}) {
  const { changes } = db.prepare(
    `UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL ${userId != null ? 'AND user_id = ?' : ''}`
  ).run(...(userId != null ? [id, userId] : [id]))
  return changes > 0
}

function safeEqual(a, b) {
  const ba = Buffer.from(sha256(a), 'hex')
  const bb = Buffer.from(sha256(b), 'hex')
  return timingSafeEqual(ba, bb)
}

// Returns { tokenId, name, userId } or null. Tokens of a disabled user stop working.
export function authenticate(db, presented) {
  if (!presented) return null
  const env = config.agentApiToken
  if (env && safeEqual(presented, env)) return { tokenId: null, name: 'env', userId: null }
  const row = db.prepare(
    `SELECT t.id, t.name, t.user_id FROM api_tokens t LEFT JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.disabled_at IS NULL`
  ).get(sha256(presented))
  if (!row) return null
  db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id)
  return { tokenId: row.id, name: row.name, userId: row.user_id }
}
