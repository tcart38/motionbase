import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { config } from '../config.js'

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

// Tokens look like mb_<43 url-safe chars>. Only the sha256 is stored; the plaintext
// is returned exactly once, at creation.
export function createToken(db, name) {
  const label = String(name || '').trim()
  if (!label) throw Object.assign(new Error('name is required'), { status: 400 })
  const token = 'mb_' + randomBytes(32).toString('base64url')
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO api_tokens (name, token_hash, token_prefix) VALUES (?, ?, ?)'
  ).run(label.slice(0, 80), sha256(token), token.slice(0, 7))
  return { ...getToken(db, lastInsertRowid), token }
}

export function getToken(db, id) {
  return db.prepare(
    'SELECT id, name, token_prefix, created_at, last_used_at, revoked_at FROM api_tokens WHERE id = ?'
  ).get(id)
}

export function listTokens(db) {
  return db.prepare(
    'SELECT id, name, token_prefix, created_at, last_used_at, revoked_at FROM api_tokens ORDER BY id DESC'
  ).all()
}

export function revokeToken(db, id) {
  const { changes } = db.prepare(
    "UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL"
  ).run(id)
  return changes > 0
}

function safeEqual(a, b) {
  const ba = Buffer.from(sha256(a), 'hex')
  const bb = Buffer.from(sha256(b), 'hex')
  return timingSafeEqual(ba, bb)
}

// Returns { tokenId, name } or null.
export function authenticate(db, presented) {
  if (!presented) return null
  const env = config.agentApiToken
  if (env && safeEqual(presented, env)) return { tokenId: null, name: 'env' }
  const row = db.prepare(
    'SELECT id, name FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL'
  ).get(sha256(presented))
  if (!row) return null
  db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id)
  return { tokenId: row.id, name: row.name }
}
