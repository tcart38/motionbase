import { getDb } from '../db/index.js'
import { authenticate } from '../services/tokens.js'

// Requires `Authorization: Bearer mb_...`. Sets req.agent = { tokenId, name }.
export function agentAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const m = /^Bearer\s+(\S+)$/i.exec(header)
  const agent = m ? authenticate(getDb(), m[1]) : null
  if (!agent) {
    res.set('WWW-Authenticate', 'Bearer realm="motionbase-agent"')
    return res.status(401).json({ error: 'Missing or invalid bearer token' })
  }
  req.agent = agent
  next()
}
