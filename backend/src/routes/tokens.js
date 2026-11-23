import { Router } from 'express'
import { getDb } from '../db/index.js'
import { createToken, listTokens, revokeToken, getToken } from '../services/tokens.js'
import { audit, userActor } from '../services/auth.js'

const router = Router()

// With login on, users see only their own tokens; admins see everyone's (each has `owner`).
const scope = (req) => (req.authEnabled && req.user.role !== 'admin' ? { userId: req.user.id } : {})

router.get('/', (req, res) => res.json(listTokens(getDb(), scope(req))))

// The plaintext token is only ever present in this response. It belongs to the signed-in user.
router.post('/', (req, res) => {
  const db = getDb()
  const created = createToken(db, req.body?.name, req.user?.id ?? null)
  audit(db, userActor(req.user), 'token_created', { id: created.id, name: created.name })
  res.status(201).json(created)
})

router.delete('/:id', (req, res) => {
  const db = getDb()
  const id = Number(req.params.id)
  const tok = getToken(db, id)
  if (!revokeToken(db, id, scope(req))) return res.status(404).json({ error: 'Not found or already revoked' })
  audit(db, userActor(req.user), 'token_revoked', { id, name: tok?.name, owner_id: tok?.user_id ?? null })
  res.json({ revoked: true })
})

export default router
