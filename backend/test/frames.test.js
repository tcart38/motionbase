import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'child_process'
import path from 'path'
import { startTestServer, addFile, hasFfmpeg } from './helpers.js'
import { frameTimes, sheetLayout } from '../src/services/frames.js'

let ctx, H, vid, img
before(async () => {
  ctx = await startTestServer()
  H = { Authorization: `Bearer ${(await ctx.post('/api/tokens', { name: 'f' })).data.token}` }
  if (hasFfmpeg) {
    const v = path.join(ctx.mediaDir, 'clip.mp4')
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=10:duration=6', '-pix_fmt', 'yuv420p', v])
    vid = addFile(ctx, 'clip.mp4', { filepath: v, duration: 6, width: 640, height: 360 })
    const i = path.join(ctx.mediaDir, 'pic.png')
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=100x200', '-frames:v', '1', i])
    img = addFile(ctx, 'pic.png', { filepath: i, file_type: 'image', duration: null, width: 100, height: 200 })
  }
})
after(() => ctx.close())

const A = '/api/agent/v1'

test('frameTimes are evenly spaced mid-slice; sheet layout fits 1568px', () => {
  assert.deepEqual(frameTimes(10, 5), [1, 3, 5, 7, 9])
  assert.deepEqual(frameTimes(null, 2), [0, 0])
  for (const [w, h, count, cols] of [[1920, 1080, 16, 4], [1080, 1920, 9, 3], [640, 360, 9, 3], [100, 2000, 16, 2]]) {
    const L = sheetLayout({ file_type: 'video', width: w, height: h }, count, cols)
    assert.ok(L.cols * L.tileW <= 1568 && L.rows * L.tileH <= 1568, JSON.stringify(L))
  }
})

test('frames listing needs no ffmpeg and clamps parameters', async () => {
  const id = addFile(ctx, 'meta.mp4', { duration: 20 })
  const r = await ctx.get(`${A}/files/${id}/frames?count=99&width=5000`, H)
  assert.equal(r.data.count, 16)
  assert.equal(r.data.width, 1024)
  assert.equal(r.data.frames.length, 16)
  assert.equal((await ctx.get(`${A}/files/${id}/frames?count=x`, H)).status, 400)
  assert.equal((await ctx.get(`${A}/files/${id}/frames/0.jpg`)).status, 401)
  assert.equal((await ctx.get(`${A}/files/${id}/thumbnail.jpg`, H)).status, 404)
  assert.equal((await ctx.get(`${A}/files/${id}/frames/0.jpg`, H)).status, hasFfmpeg ? 422 : 503) // source is a stub, not decodable media
})

test('frames, contact sheet (needs ffmpeg)', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const isJpeg = (b) => b[0] === 0xff && b[1] === 0xd8
  let r = await ctx.get(`${A}/files/${vid}/frames/2.jpg?count=4&width=320`, H)
  assert.equal(r.status, 200)
  assert.ok(isJpeg(r.data))
  assert.equal((await ctx.get(`${A}/files/${vid}/frames/4.jpg?count=4`, H)).status, 404)

  r = await ctx.get(`${A}/files/${vid}/contact-sheet.jpg?count=9&cols=3`, H)
  assert.equal(r.status, 200)
  assert.ok(isJpeg(r.data))
  assert.equal(r.headers.get('x-frame-times').split(',').length, 9)
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', '-'], { input: r.data }).stdout.toString().trim()
  const [w, h] = probe.split(',').map(Number)
  assert.ok(Math.max(w, h) <= 1568, probe)

  r = await ctx.get(`${A}/files/${img}/contact-sheet.jpg?count=9`, H)
  assert.equal(r.status, 200) // images yield a single tile
  assert.equal((await ctx.get(`${A}/files/${img}/frames/0.jpg`, H)).status, 200)

  // cache invalidated on delete
  const { existsSync } = await import('fs')
  const dir = path.join(ctx.dataDir, 'frames', String(vid))
  assert.ok(existsSync(dir))
  await ctx.del(`/api/files/${vid}`)
  assert.equal(existsSync(dir), false)
})
