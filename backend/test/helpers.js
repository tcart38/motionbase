import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { spawnSync } from 'child_process'
import os from 'os'
import path from 'path'

export const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

// Boots an isolated server (temp DATA_DIR/MEDIA_DIR, port 0). Call from each test
// file's `before`; node --test runs every file in its own process so the db
// singleton is not shared.
export async function startTestServer(env = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'motionbase-test-'))
  const dataDir = path.join(root, 'data')
  const mediaDir = path.join(root, 'media')
  mkdirSync(dataDir)
  mkdirSync(mediaDir)
  Object.assign(process.env, { DATA_DIR: dataDir, MEDIA_DIR: mediaDir, ...env })

  const { initDb, getDb, closeDb } = await import('../src/db/index.js')
  const { createApp } = await import('../src/app.js')
  initDb()
  const server = createApp({ serveFrontend: false }).listen(0)
  await new Promise((r) => server.once('listening', r))
  const baseUrl = `http://127.0.0.1:${server.address().port}`

  async function api(method, url, body, headers = {}) {
    const res = await fetch(baseUrl + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const ct = res.headers.get('content-type') || ''
    const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())
    return { status: res.status, data, headers: res.headers }
  }

  return {
    baseUrl, dataDir, mediaDir, db: getDb(), api,
    get: (u, h) => api('GET', u, undefined, h),
    post: (u, b = {}, h) => api('POST', u, b, h),
    patch: (u, b = {}, h) => api('PATCH', u, b, h),
    del: (u, h) => api('DELETE', u, undefined, h),
    async close() {
      await new Promise((r) => server.close(r))
      closeDb()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

// Insert a file row directly (no ffprobe needed).
export function addFile(ctx, name, extra = {}) {
  const filepath = extra.filepath || path.join(ctx.mediaDir, name)
  if (!extra.filepath) writeFileSync(filepath, 'x')
  const { filepath: _fp, ...cols } = extra
  const row = { filepath, filename: name, file_type: 'video', duration: 10, width: 1920, height: 1080, ...cols }
  const keys = Object.keys(row)
  const { lastInsertRowid } = ctx.db
    .prepare(`INSERT INTO files (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map((k) => row[k]))
  return Number(lastInsertRowid)
}
