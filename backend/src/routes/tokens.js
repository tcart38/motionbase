import { Router } from 'express'
import { getDb } from '../db/index.js'
import { createToken, listTokens, revokeToken } from '../services/tokens.js'

const router = Router()

router.get('/', (req, res) => res.json(listTokens(getDb())))

// The plaintext token is only ever present in this response.
router.post('/', (req, res) => {
  res.status(201).json(createToken(getDb(), req.body?.name))
})

router.delete('/:id', (req, res) => {
  if (!revokeToken(getDb(), Number(req.params.id))) return res.status(404).json({ error: 'Not found or already revoked' })
  res.json({ revoked: true })
})

export default router
