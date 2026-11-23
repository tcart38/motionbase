import { getDb } from '../db/index.js'
import {
  SESSION_COOKIE, isAuthEnabled, parseCookies, resolveSession, setSessionCookie,
} from '../services/auth.js'

// Paths that never need a session even when login is on. The agent API and MCP use bearer tokens.
const PUBLIC = [
  /^\/api\/auth\/(status|login|setup|enable|signup)$/,
  /^\/api\/health$/,
  /^\/api\/agent\/v1(\/|$)/,
  /^\/mcp(\/|$)/,
]
const guarded = (p) => p.startsWith('/api/') || p === '/api' || p.startsWith('/thumbnails')
const isPublic = (p) => PUBLIC.some((re) => re.test(p))
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

// Origin (when the browser sends one) must be this host; body requests must be JSON
// (multipart is allowed for uploads only).
function csrfProblem(req) {
  if (SAFE.has(req.method)) return null
  const origin = req.headers.origin
  if (origin !== undefined) {
    let host = null
    try { host = new URL(origin).host } catch { /* "null" etc. */ }
    const allowed = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean)
    if (!host || !allowed.includes(host)) return 'Cross-origin request blocked'
  }
  const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding']
  if (hasBody && !req.is('json') && !(req.path === '/api/upload' && req.is('multipart/form-data'))) {
    return 'Content-Type must be application/json'
  }
  return null
}

// Sets req.authEnabled and req.user (null when login is off). When login is on, everything
// under /api and /thumbnails needs a valid session cookie except the public paths above.
export function sessionMiddleware(req, res, next) {
  const db = getDb()
  req.authEnabled = isAuthEnabled(db)
  req.user = null
  if (!req.authEnabled || !guarded(req.path)) return next()

  const agentPath = /^\/api\/agent\/v1(\/|$)/.test(req.path) || /^\/mcp(\/|$)/.test(req.path)
  if (!agentPath) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    const s = resolveSession(db, token)
    if (s) {
      req.user = s.user
      req.sessionId = s.sessionId
      req.sessionToken = token
      if (s.refreshed) setSessionCookie(req, res, token)
    }
  }

  const authPost = /^\/api\/auth\/(login|setup|enable|signup)$/.test(req.path)
  if (req.user || authPost) {
    const problem = csrfProblem(req)
    if (problem) return res.status(403).json({ error: problem })
  }
  if (isPublic(req.path) || req.user) return next()
  res.status(401).json({ error: 'Login required', login_required: true })
}

// 401 unless signed in (when login is off there is no user, so account routes say so).
export function requireUser(req, res, next) {
  if (req.user) return next()
  res.status(401).json({ error: req.authEnabled ? 'Login required' : 'Login is not enabled', login_required: req.authEnabled })
}

// Admin-only. When login is off everyone is effectively an admin (today's behaviour).
export function requireAdmin(req, res, next) {
  if (!req.authEnabled) return next()
  if (!req.user) return res.status(401).json({ error: 'Login required', login_required: true })
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access required' })
  next()
}
