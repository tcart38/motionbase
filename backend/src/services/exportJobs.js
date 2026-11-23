// Server-side export jobs. One runs at a time, in-process; the rest wait in a queue.
// Job state is kept in memory and persisted as JSON under EXPORT_DIR/.jobs so finished
// exports stay listed (and deletable) after a restart. A job that was running when the
// server stopped is marked failed on the next load.
import { promises as fs, createWriteStream, existsSync } from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { HttpError } from './errors.js'
import { fileTotals, runExport } from './exporter.js'
import { ZipSink, FolderSink, ZIP64_THRESHOLD } from './exportSinks.js'

// Test seam: replace to simulate free space.
export const deps = {
  async statfs(dir) { return fs.statfs(dir) },
}

const jobs = new Map()
const queue = []
let running = null
let loaded = null

const jobsDir = () => path.join(config.exportDir, '.jobs')
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
const PUBLIC = [
  'id', 'state', 'mode', 'layout', 'include_history', 'include_trash', 'created_at', 'started_at', 'finished_at',
  'files_done', 'files_total', 'files_skipped', 'bytes_done', 'bytes_total', 'needed_bytes', 'output_bytes',
  'path', 'download_url', 'error', 'created_by',
]

export function publicJob(j) {
  const out = {}
  for (const k of PUBLIC) out[k] = j[k] ?? null
  out.skipped = (j.skipped || []).slice(0, 50)
  return out
}

async function persist(job) {
  try {
    await fs.mkdir(jobsDir(), { recursive: true })
    await fs.writeFile(path.join(jobsDir(), `${job.id}.json`), JSON.stringify({ ...publicJob(job), skipped: (job.skipped || []).slice(0, 200) }))
  } catch { /* best effort */ }
}

async function load() {
  loaded ??= (async () => {
    let names = []
    try { names = (await fs.readdir(jobsDir())).filter((n) => n.endsWith('.json')) } catch { return }
    for (const n of names) {
      try {
        const j = JSON.parse(await fs.readFile(path.join(jobsDir(), n), 'utf8'))
        if (!j?.id || jobs.has(j.id)) continue
        if (j.state === 'queued' || j.state === 'running') {
          Object.assign(j, { state: 'failed', error: 'Interrupted by a server restart', finished_at: new Date().toISOString() })
          await persist(j)
        }
        jobs.set(j.id, j)
      } catch { /* corrupt file: ignore */ }
    }
  })()
  return loaded
}

async function freeBytes(dir) {
  const s = await deps.statfs(dir)
  return Number(s.bavail) * Number(s.bsize)
}

const insideDir = (child, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

const err507 = (needed, free) => new HttpError(507, `Not enough free disk space for this export: about ${needed} bytes needed, ${free} available in ${config.exportDir}`, { needed_bytes: needed, free_bytes: free })

export function estimateNeeded({ mode, includeHistory }, totals) {
  const meta = totals.count * (includeHistory ? 8192 : 4096) + 1024 * 1024
  return (mode === 'full' ? totals.bytes : 0) + meta
}

export async function createJob(opts, by) {
  await load()
  const mode = opts.mode ?? 'full'
  const layout = opts.layout ?? 'zip'
  if (!['full', 'metadata'].includes(mode)) throw new HttpError(400, "mode must be 'full' or 'metadata'")
  if (!['zip', 'folder'].includes(layout)) throw new HttpError(400, "layout must be 'zip' or 'folder'")
  const dir = config.exportDir
  if (path.resolve(dir) === path.resolve(config.mediaDir) || insideDir(dir, config.mediaDir)) {
    throw new HttpError(400, 'EXPORT_DIR must not be inside MEDIA_DIR (the scanner would import the exported files)')
  }
  await fs.mkdir(dir, { recursive: true })

  const includeTrash = opts.include_trash === true || opts.include_trash === 1 || opts.include_trash === '1'
  const includeHistory = opts.include_history === true || opts.include_history === 1 || opts.include_history === '1'
  const totals = fileTotals(getDb(), { includeTrash })
  const needed = estimateNeeded({ mode, includeHistory }, totals)
  const free = await freeBytes(dir)
  if (free < needed) throw err507(needed, free)

  const id = randomBytes(6).toString('hex')
  const base = `motionbase-export-${stamp()}`
  const job = {
    id, state: 'queued', mode, layout, include_history: includeHistory, include_trash: includeTrash,
    created_at: new Date().toISOString(), started_at: null, finished_at: null,
    files_done: 0, files_total: mode === 'full' ? totals.count : totals.count, files_skipped: 0,
    bytes_done: 0, bytes_total: mode === 'full' ? totals.bytes : 0, needed_bytes: needed, output_bytes: null,
    path: null, download_url: null, error: null,
    created_by: by?.label ?? null, skipped: [],
  }
  job.path = path.join(dir, layout === 'zip' ? `${base}.zip` : base)
  if (existsSync(job.path) || jobs.size && [...jobs.values()].some((j) => j.path === job.path)) job.path = path.join(dir, layout === 'zip' ? `${base}-${id}.zip` : `${base}-${id}`)
  job.controller = new AbortController()
  Object.defineProperty(job, 'controller', { enumerable: false })
  jobs.set(id, job)
  queue.push(job)
  await persist(job)
  kick()
  return job
}

function kick() {
  if (running || !queue.length) return
  const job = queue.shift()
  if (job.state !== 'queued') return kick()
  running = runJob(job).finally(() => { running = null; kick() })
}

async function cleanupOutput(job) {
  await fs.rm(job.path, { recursive: true, force: true }).catch(() => {})
  await fs.rm(`${job.path}.partial`, { force: true }).catch(() => {})
}

async function runJob(job) {
  job.state = 'running'
  job.started_at = new Date().toISOString()
  await persist(job)
  const signal = job.controller.signal
  try {
    // Space may have changed while the job waited in the queue.
    const free = await freeBytes(config.exportDir)
    if (free < job.needed_bytes) throw err507(job.needed_bytes, free)

    let sink
    let tmp
    if (job.layout === 'zip') {
      tmp = `${job.path}.partial`
      sink = new ZipSink(createWriteStream(tmp, { flags: 'w' }), { forceZip64: job.bytes_total >= ZIP64_THRESHOLD, signal })
    } else {
      await fs.mkdir(job.path, { recursive: false })
      sink = new FolderSink(job.path, { signal })
    }
    try {
      await runExport(getDb(), sink, { mode: job.mode, includeHistory: job.include_history, includeTrash: job.include_trash, signal, counters: job })
      await sink.finish()
    } catch (e) { sink.abort(); throw e }
    if (tmp) await fs.rename(tmp, job.path)
    const st = await fs.stat(job.path).catch(() => null)
    job.output_bytes = job.layout === 'zip' ? st?.size ?? null : job.bytes_done
    job.files_done = job.files_total
    job.state = 'done'
    if (job.layout === 'zip') job.download_url = `/api/export/jobs/${job.id}/download`
  } catch (e) {
    await cleanupOutput(job)
    if (signal.aborted || e?.name === 'AbortError') {
      job.state = 'cancelled'
    } else {
      job.state = 'failed'
      job.error = e?.message || String(e)
      if (e?.status === 507) job.error_status = 507
    }
  }
  job.finished_at = new Date().toISOString()
  await persist(job)
}

export async function listJobs(limit = 50) {
  await load()
  return [...jobs.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit)
}

export async function getJob(id) {
  await load()
  return jobs.get(id) || null
}

export async function cancelJob(id) {
  const job = await getJob(id)
  if (!job) throw new HttpError(404, 'Not found')
  if (job.state === 'queued') {
    job.state = 'cancelled'
    job.finished_at = new Date().toISOString()
    await persist(job)
  } else if (job.state === 'running') {
    job.controller.abort()
  } else {
    throw new HttpError(409, `Job is already ${job.state}`)
  }
  return job
}

export async function deleteJob(id) {
  const job = await getJob(id)
  if (!job) throw new HttpError(404, 'Not found')
  if (job.state === 'queued' || job.state === 'running') throw new HttpError(409, 'Cancel the job before deleting it')
  // Only ever remove things inside EXPORT_DIR.
  if (job.path && insideDir(job.path, config.exportDir)) await cleanupOutput(job)
  await fs.rm(path.join(jobsDir(), `${id}.json`), { force: true })
  jobs.delete(id)
}

// Resolves when nothing is running or queued (tests, graceful shutdown).
export async function idle() {
  while (running || queue.length) await (running || new Promise((r) => setTimeout(r, 10))).catch(() => {})
}

// Tests only: forget in-memory state so the next call reloads from disk.
export function _reset() { jobs.clear(); queue.length = 0; loaded = null }
