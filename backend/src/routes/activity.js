import { Router } from 'express'
import { getDb } from '../db/index.js'
import { listActivity, getActivity, revertActivity } from '../services/activity.js'

const router = Router()

router.get('/', (req, res) => res.json(listActivity(getDb(), req.query)))

router.get('/:id', (req, res) => {
  const a = getActivity(getDb(), Number(req.params.id))
  if (!a) return res.status(404).json({ error: 'Not found' })
  res.json(a)
})

router.post('/:id/revert', (req, res) => {
  res.json(revertActivity(getDb(), Number(req.params.id)))
})

export default router
