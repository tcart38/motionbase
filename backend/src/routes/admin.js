import { Router } from 'express'
import { getDb } from '../db/index.js'
import { requireAdmin } from '../middleware/session.js'
import { listAudit } from '../services/auth.js'

const router = Router()
router.use(requireAdmin)

// GET /api/admin/audit?limit=100&before=<id> -> { entries: [...], next_before }
router.get('/audit', (req, res) => res.json(listAudit(getDb(), req.query)))

export default router
