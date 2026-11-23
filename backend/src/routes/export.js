import { Router } from 'express'
import express from 'express'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { promises as fs } from 'fs'
import path from 'path'
import { getDb } from '../db/index.js'
import { requireAdmin } from '../middleware/session.js'
import { actorFromReq } from '../services/history.js'
import { audit, userActor } from '../services/auth.js'
import { HttpError } from '../services/errors.js'
import { flag, metadataCsv, metadataJson, fileTotals, runExport } from '../services/exporter.js'
import { ZipSink, ZIP64_THRESHOLD } from '../services/exportSinks.js'
import { createJob, listJobs, getJob, cancelJob, deleteJob, publicJob } from '../services/exportJobs.js'
import { importMetadata } from '../services/metadataImport.js'

const router = Router()
router.use(requireAdmin)

// Express 4 does not catch rejected promises from async handlers.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

const day = () => new Date().toISOString().slice(0, 10)
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
const swallowClose = (e) => {
  if (!['ERR_STREAM_PREMATURE_CLOSE', 'ABORT_ERR', 'ERR_STREAM_DESTROYED'].includes(e?.code) && e?.name !== 'AbortError') throw e
}

// GET /api/export/estimate?include_trash=0 -> { files, bytes } that a full export would contain.
router.get('/estimate', (req, res) => {
  const t = fileTotals(getDb(), { includeTrash: flag(req.query.include_trash) })
  res.json({ files: t.count, bytes: t.bytes })
})

// GET /api/export/metadata?format=csv|json&include_trash=0&include_history=0 (history is JSON only)
router.get('/metadata', ah(async (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase()
  if (!['csv', 'json'].includes(format)) throw new HttpError(400, "format must be 'csv' or 'json'")
  const opts = { includeTrash: flag(req.query.include_trash), includeHistory: flag(req.query.include_history) }
  const db = getDb()
  audit(db, userActor(req.user), 'export', { kind: 'metadata', format, ...opts })
  res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="motionbase-metadata-${day()}.${format}"`)
  res.setHeader('Cache-Control', 'no-store')
  try {
    await pipeline(Readable.from(format === 'csv' ? metadataCsv(db, opts) : metadataJson(db, opts)), res)
  } catch (e) {
    swallowClose(e)
    if (!res.destroyed) res.destroy(e)
  }
}))

// GET /api/export/download.zip?include_trash=0&include_history=0: streamed full export.
router.get('/download.zip', ah(async (req, res) => {
  const db = getDb()
  const includeTrash = flag(req.query.include_trash)
  const includeHistory = flag(req.query.include_history)
  const totals = fileTotals(db, { includeTrash })
  audit(db, userActor(req.user), 'export', { kind: 'download', include_trash: includeTrash, include_history: includeHistory, files: totals.count })
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="motionbase-export-${stamp()}.zip"`)
  res.setHeader('Cache-Control', 'no-store')
  // Chunked: the size is unknown up front. Client aborts stop the work.
  const controller = new AbortController()
  res.on('close', () => { if (!res.writableFinished) controller.abort() })
  const sink = new ZipSink(res, { forceZip64: totals.bytes >= ZIP64_THRESHOLD, signal: controller.signal })
  try {
    await runExport(db, sink, { mode: 'full', includeHistory, includeTrash, signal: controller.signal, counters: { files_total: totals.count } })
    await sink.finish()
  } catch (e) {
    sink.abort()
    if (!controller.signal.aborted) {
      console.error('export download failed:', e)
      if (!res.headersSent) res.status(500).json({ error: 'Export failed' })
    }
  }
}))

const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {})

// POST /api/export/jobs { mode, include_history, include_trash, layout } -> 202 { id, ...job }
router.post('/jobs', ah(async (req, res) => {
  const b = body(req)
  let job
  try { job = await createJob(b, actorFromReq(req)) } catch (e) {
    if (e.status === 507) return res.status(507).json({ error: e.message, needed_bytes: e.needed_bytes, free_bytes: e.free_bytes })
    throw e
  }
  audit(getDb(), userActor(req.user), 'export', { kind: 'job', id: job.id, mode: job.mode, layout: job.layout, include_trash: job.include_trash, include_history: job.include_history })
  res.status(202).json(publicJob(job))
}))

router.get('/jobs', ah(async (req, res) => {
  res.json({ jobs: (await listJobs(Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50)))).map(publicJob) })
}))

router.get('/jobs/:id', ah(async (req, res) => {
  const job = await getJob(req.params.id)
  if (!job) throw new HttpError(404, 'Not found')
  res.json(publicJob(job))
}))

router.post('/jobs/:id/cancel', ah(async (req, res) => {
  res.json(publicJob(await cancelJob(req.params.id)))
}))

router.delete('/jobs/:id', ah(async (req, res) => {
  await deleteJob(req.params.id)
  res.json({ deleted: true })
}))

// Streams a finished zip; Range requests work (resumable downloads).
router.get('/jobs/:id/download', ah(async (req, res) => {
  const job = await getJob(req.params.id)
  if (!job) throw new HttpError(404, 'Not found')
  if (job.state !== 'done' || job.layout !== 'zip') throw new HttpError(409, 'Only finished zip exports can be downloaded')
  const st = await fs.stat(job.path).catch(() => null)
  if (!st) throw new HttpError(410, 'The export file is no longer on disk')
  audit(getDb(), userActor(req.user), 'export', { kind: 'job_download', id: job.id })
  res.download(job.path, path.basename(job.path), (e) => { if (e && !res.headersSent) res.status(500).json({ error: 'Download failed' }) })
}))

export default router

// POST /api/import/metadata?dry_run=1&overwrite_notes=0 with an exported metadata.json as the body.
export const metadataImportRouter = Router()
metadataImportRouter.use(requireAdmin)
metadataImportRouter.use(express.json({ limit: '100mb' }))
metadataImportRouter.post('/', (req, res) => {
  const dryRun = flag(req.query.dry_run)
  const db = getDb()
  const result = importMetadata(db, req.body, { dryRun, overwriteNotes: flag(req.query.overwrite_notes), by: actorFromReq(req) })
  if (!dryRun) {
    const { unmatched, errors, ...counts } = result
    audit(db, userActor(req.user), 'metadata_import', counts)
  }
  res.json(result)
})
