import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'fs'
import path from 'path'
import os from 'os'
import { startTestServer, addFile } from './helpers.js'
import { readZip } from './zipReader.js'

let t, exportDir, jobs, exporter
before(async () => {
  exportDir = path.join(os.tmpdir(), `motionbase-exports-${process.pid}-${Date.now()}`)
  t = await startTestServer({ EXPORT_DIR: exportDir })
  jobs = await import('../src/services/exportJobs.js')
  exporter = await import('../src/services/exporter.js')
  mkdirSync(path.join(t.mediaDir, 'dir'))
  t.db.prepare("INSERT INTO folders (name) VALUES ('F')").run()
  const f = t.db.prepare("SELECT id FROM folders WHERE name='F'").get().id
  for (let i = 0; i < 6; i++) addFile(t, `v${i}.mp4`, { file_size: 1, folder_id: i % 2 ? f : null })
  addFile(t, 'trashed.mp4', { file_size: 1, deleted_at: '2026-01-01 00:00:00' })
})
after(async () => {
  await t.close()
  const { rmSync } = await import('fs')
  rmSync(exportDir, { recursive: true, force: true })
})

const waitState = async (id, states, ms = 5000) => {
  const end = Date.now() + ms
  for (;;) {
    const j = (await t.get(`/api/export/jobs/${id}`)).data
    if (states.includes(j.state)) return j
    if (Date.now() > end) throw new Error(`timeout waiting for ${states}; at ${j.state}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

test('zip job: runs, reports progress, writes a zip under EXPORT_DIR and serves it with Range', async () => {
  const r = await t.post('/api/export/jobs', { mode: 'full', layout: 'zip' })
  assert.equal(r.status, 202)
  assert.ok(r.data.id)
  const j = await waitState(r.data.id, ['done', 'failed'])
  assert.equal(j.state, 'done', j.error)
  assert.equal(j.files_total, 6); assert.equal(j.files_done, 6)
  assert.equal(j.bytes_done, 6); assert.equal(j.bytes_total, 6)
  assert.ok(j.path.startsWith(exportDir) && j.path.endsWith('.zip'))
  assert.equal(j.download_url, `/api/export/jobs/${j.id}/download`)
  assert.ok(existsSync(j.path))
  const z = readZip(readFileSync(j.path))
  assert.ok(z.names.includes('videos/F/v1.mp4') && z.names.includes('videos/v0.mp4'))
  assert.ok(!z.names.includes('videos/trashed.mp4'))
  assert.ok(!readdirSync(exportDir).some((n) => n.endsWith('.partial')))

  const dl = await t.get(j.download_url)
  assert.equal(dl.status, 200)
  assert.deepEqual(Buffer.from(dl.data), readFileSync(j.path))
  const part = await fetch(t.baseUrl + j.download_url, { headers: { Range: 'bytes=0-3' } })
  assert.equal(part.status, 206)
  assert.equal((await part.arrayBuffer()).byteLength, 4)

  const list = (await t.get('/api/export/jobs')).data.jobs
  assert.ok(list.some((x) => x.id === j.id))
})

test('folder job copies files with the same structure (no zip) and include_trash', async () => {
  const r = await t.post('/api/export/jobs', { mode: 'full', layout: 'folder', include_trash: true, include_history: true })
  const j = await waitState(r.data.id, ['done', 'failed'])
  assert.equal(j.state, 'done', j.error)
  assert.equal(j.download_url, null)
  assert.match(path.basename(j.path), /^motionbase-export-\d{8}-\d{6}/)
  assert.equal(readFileSync(path.join(j.path, 'videos/F/v1.mp4'), 'utf8'), 'x')
  assert.ok(existsSync(path.join(j.path, 'videos/trashed.mp4')))
  for (const n of ['metadata.csv', 'metadata.json', 'README.txt']) assert.ok(existsSync(path.join(j.path, n)), n)
  assert.equal(JSON.parse(readFileSync(path.join(j.path, 'metadata.json'), 'utf8')).files.length, 7)
  assert.equal((await t.get(`/api/export/jobs/${j.id}/download`)).status, 409)
})

test('metadata-only job; delete removes the output; unknown ids 404', async () => {
  const r = await t.post('/api/export/jobs', { mode: 'metadata', layout: 'zip' })
  const j = await waitState(r.data.id, ['done', 'failed'])
  assert.equal(j.state, 'done', j.error)
  const z = readZip(readFileSync(j.path))
  assert.deepEqual(z.names.sort(), ['README.txt', 'metadata.csv', 'metadata.json'])
  assert.equal((await t.del(`/api/export/jobs/${j.id}`)).status, 200)
  assert.ok(!existsSync(j.path))
  assert.equal((await t.get(`/api/export/jobs/${j.id}`)).status, 404)
  assert.equal((await t.get('/api/export/jobs/nope')).status, 404)
  assert.equal((await t.post('/api/export/jobs/nope/cancel')).status, 404)
  assert.equal((await t.post('/api/export/jobs', { mode: 'bogus' })).status, 400)
  assert.equal((await t.post('/api/export/jobs', { layout: 'tar' })).status, 400)
})

test('cancel a running job: partial output is removed; queued jobs wait their turn', async () => {
  let release
  const gate = new Promise((r) => { release = r })
  let reached
  const atFirst = new Promise((r) => { reached = r })
  let n = 0
  exporter.hooks.beforeFile = async () => { if (++n === 3) reached(); if (n >= 3) await gate }
  try {
    const a = (await t.post('/api/export/jobs', { mode: 'full', layout: 'folder' })).data
    const b = (await t.post('/api/export/jobs', { mode: 'metadata', layout: 'zip' })).data
    await atFirst
    const running = (await t.get(`/api/export/jobs/${a.id}`)).data
    assert.equal(running.state, 'running')
    assert.ok(running.files_done >= 1 && running.files_done < running.files_total)
    assert.equal((await t.get(`/api/export/jobs/${b.id}`)).data.state, 'queued') // one at a time
    assert.equal((await t.post(`/api/export/jobs/${a.id}/cancel`)).status, 200)
    release()
    const ca = await waitState(a.id, ['cancelled', 'done', 'failed'])
    assert.equal(ca.state, 'cancelled')
    assert.ok(!existsSync(ca.path))
    exporter.hooks.beforeFile = null
    assert.equal((await waitState(b.id, ['done', 'failed'])).state, 'done')
    assert.equal((await t.post(`/api/export/jobs/${a.id}/cancel`)).status, 409)
  } finally { release(); exporter.hooks.beforeFile = null }
})

test('cancelling a queued job never runs it', async () => {
  let release
  const gate = new Promise((r) => { release = r })
  let reached; const at = new Promise((r) => { reached = r })
  exporter.hooks.beforeFile = async () => { reached(); await gate }
  try {
    const a = (await t.post('/api/export/jobs', { mode: 'full', layout: 'folder' })).data
    const b = (await t.post('/api/export/jobs', { mode: 'full', layout: 'folder' })).data
    await at
    assert.equal((await t.post(`/api/export/jobs/${b.id}/cancel`)).data.state, 'cancelled')
    exporter.hooks.beforeFile = null
    release()
    assert.equal((await waitState(a.id, ['done', 'failed'])).state, 'done')
    const bj = (await t.get(`/api/export/jobs/${b.id}`)).data
    assert.equal(bj.state, 'cancelled'); assert.equal(bj.started_at, null)
  } finally { release(); exporter.hooks.beforeFile = null }
})

test('disk-space pre-check refuses with 507 and a clear message', async () => {
  const real = jobs.deps.statfs
  jobs.deps.statfs = async () => ({ bavail: 0, bsize: 4096 })
  try {
    const r = await t.post('/api/export/jobs', { mode: 'full' })
    assert.equal(r.status, 507)
    assert.match(r.data.error, /Not enough free disk space/)
    assert.ok(r.data.needed_bytes > 0 && r.data.free_bytes === 0)
    // plenty of space for small ones
    jobs.deps.statfs = async () => ({ bavail: 1e9, bsize: 4096 })
    const ok = await t.post('/api/export/jobs', { mode: 'metadata' })
    assert.equal(ok.status, 202)
    await waitState(ok.data.id, ['done'])
    // space vanishing while queued fails the job instead of filling the disk
    let calls = 0
    jobs.deps.statfs = async () => ({ bavail: ++calls === 1 ? 1e9 : 0, bsize: 4096 })
    const late = (await t.post('/api/export/jobs', { mode: 'full' })).data
    const lj = await waitState(late.id, ['failed', 'done'])
    assert.equal(lj.state, 'failed')
    assert.match(lj.error, /Not enough free disk space/)
  } finally { jobs.deps.statfs = real }
})

test('jobs survive a restart (reloaded from EXPORT_DIR); interrupted jobs are marked failed', async () => {
  const { writeFileSync } = await import('fs')
  const r = await t.post('/api/export/jobs', { mode: 'metadata' })
  const j = await waitState(r.data.id, ['done'])
  writeFileSync(path.join(exportDir, '.jobs', 'dead.json'), JSON.stringify({ id: 'dead', state: 'running', path: path.join(exportDir, 'x.zip') }))
  jobs._reset()
  const list = (await t.get('/api/export/jobs')).data.jobs
  assert.equal(list.find((x) => x.id === j.id).state, 'done')
  assert.equal(list.find((x) => x.id === 'dead').state, 'failed')
})

test('EXPORT_DIR inside MEDIA_DIR is refused', async () => {
  const prev = process.env.EXPORT_DIR
  process.env.EXPORT_DIR = path.join(t.mediaDir, 'exports')
  try {
    const r = await t.post('/api/export/jobs', { mode: 'metadata' })
    assert.equal(r.status, 400)
    assert.match(r.data.error, /EXPORT_DIR/)
  } finally { process.env.EXPORT_DIR = prev }
})
