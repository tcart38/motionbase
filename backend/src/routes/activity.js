import { Router } from 'express'
import { getDb } from '../db/index.js'
import { requireAdmin } from '../middleware/session.js'
import { actorFromReq } from '../services/history.js'
import { listActivity, getActivity, revertActivity } from '../services/activity.js'

const router = Router()

router.get('/', (req, res) => res.json(listActivity(getDb(), req.query)))

router.get('/:id', (req, res) => {
  const a = getActivity(getDb(), Number(req.params.id))
  if (!a) return res.status(404).json({ error: 'Not found' })
  res.json(a)
})

router.post('/:id/revert', requireAdmin, (req, res) => {
  res.json(revertActivity(getDb(), Number(req.params.id), { by: actorFromReq(req) }))
})

export default router
