import { Router } from 'express'
import { getDb } from '../db/index.js'
import { HttpError } from '../services/errors.js'
import { actorFromReq } from '../services/history.js'
import {
  createGroup, describeGroup, renameGroup, reorderGroup, addToGroup, removeFromGroup, ungroup,
} from '../services/groups.js'

const router = Router()
const gid = (req) => {
  const n = Number(req.params.id)
  if (!Number.isInteger(n)) throw new HttpError(404, 'Group not found')
  return n
}
// After a mutation: the group (or null when it dissolved itself).
const respond = (db, id) => describeGroup(db, id)

// POST /api/groups { file_ids: [2..500], title? } -> group. Files already in another group are moved.
router.post('/', (req, res) => {
  const db = getDb()
  const { file_ids, title } = req.body || {}
  const id = db.transaction(() => createGroup(db, file_ids, { title, by: actorFromReq(req), userId: req.user?.id ?? null }))()
  res.status(201).json(respond(db, id))
})

// GET /api/groups/:id -> { id, title, size, members: [file + tags] } in order
router.get('/:id', (req, res) => {
  const g = describeGroup(getDb(), gid(req))
  if (!g) return res.status(404).json({ error: 'Group not found' })
  res.json(g)
})

// PATCH /api/groups/:id { title?, order?: [file ids] }
router.patch('/:id', (req, res) => {
  const db = getDb()
  const id = gid(req)
  const { title, order } = req.body || {}
  db.transaction(() => {
    if (title !== undefined) renameGroup(db, id, title, actorFromReq(req))
    if (order !== undefined) reorderGroup(db, id, order)
    if (title === undefined && order === undefined) throw new HttpError(400, 'Nothing to change (title or order)')
  })()
  res.json(respond(db, id))
})

// POST /api/groups/:id/add { file_ids }
router.post('/:id/add', (req, res) => {
  const db = getDb()
  const id = gid(req)
  const added = db.transaction(() => addToGroup(db, id, req.body?.file_ids, actorFromReq(req)))()
  res.json({ added, group: respond(db, id) })
})

// POST /api/groups/:id/remove { file_ids } — a group left with < 2 live members dissolves (group: null)
router.post('/:id/remove', (req, res) => {
  const db = getDb()
  const id = gid(req)
  const removed = db.transaction(() => removeFromGroup(db, id, req.body?.file_ids, actorFromReq(req)))()
  res.json({ removed, group: respond(db, id) })
})

// POST /api/groups/:id/ungroup
router.post('/:id/ungroup', (req, res) => {
  const db = getDb()
  const id = gid(req)
  const g = describeGroup(db, id)
  if (!g) return res.status(404).json({ error: 'Group not found' })
  db.transaction(() => ungroup(db, id, actorFromReq(req)))()
  res.json({ ungrouped: g.members.length, file_ids: g.members.map((m) => m.id), title: g.title })
})

export default router
