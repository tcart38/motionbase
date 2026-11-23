import { execFile } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import path from 'path'
import { config } from '../config.js'
import { HttpError } from './errors.js'

const execFileAsync = promisify(execFile)

export const MAX_FRAMES = 16
export const MAX_WIDTH = 1024
export const MAX_SHEET_SIDE = 1568

let ffmpegChecked
export function ffmpegAvailable() {
  ffmpegChecked ??= execFileAsync('ffmpeg', ['-version']).then(() => true, () => false)
  return ffmpegChecked
}

// Counting semaphore so a burst of requests can't spawn unbounded ffmpeg processes.
let running = 0
const waiting = []
async function limited(fn) {
  if (running >= config.frameConcurrency) await new Promise((r) => waiting.push(r))
  running++
  try {
    return await fn()
  } finally {
    running--
    waiting.shift()?.()
  }
}

const inflight = new Map()
function once(key, fn) {
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)))
  return inflight.get(key)
}

export function clampInt(value, def, min, max) {
  if (value === undefined || value === '') return def
  const n = Number(value)
  if (!Number.isInteger(n)) throw new HttpError(400, 'Expected an integer')
  return Math.min(max, Math.max(min, n))
}

// Evenly spaced timestamps, each at the middle of its slice (avoids black first/last frames).
export function frameTimes(duration, count) {
  if (!duration || duration <= 0) return Array.from({ length: count }, () => 0)
  return Array.from({ length: count }, (_, i) =>
    Math.max(0, Math.min(duration - 0.05, +(duration * (i + 0.5) / count).toFixed(3))))
}

async function sourceStat(file) {
  try {
    return await fs.stat(file.filepath)
  } catch {
    throw new HttpError(404, 'File not found on disk')
  }
}

async function runFfmpeg(args) {
  if (!(await ffmpegAvailable())) throw new HttpError(503, 'ffmpeg is not available on this server')
  try {
    await limited(() => execFileAsync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...args], { timeout: 120000 }))
  } catch (err) {
    throw new HttpError(422, 'Could not extract frames (ffmpeg failed): ' + String(err.stderr || err.message).slice(0, 300))
  }
}

async function fresh(out, srcStat) {
  try {
    return (await fs.stat(out)).mtimeMs >= srcStat.mtimeMs
  } catch {
    return false
  }
}

async function render(out, srcStat, args) {
  if (await fresh(out, srcStat)) return out
  return once(out, async () => {
    await fs.mkdir(path.dirname(out), { recursive: true })
    const tmp = out.replace(/\.jpg$/, '.part.jpg')
    await runFfmpeg([...args, tmp])
    await fs.rename(tmp, out)
    return out
  })
}

function inputArgs(file, time) {
  return file.file_type === 'video' ? ['-ss', String(time), '-i', file.filepath] : ['-i', file.filepath]
}

// Number of frames actually available for a file (images have exactly one).
export function effectiveCount(file, count) {
  return file.file_type === 'image' ? 1 : count
}

export function getFrameTimes(file, count) {
  return frameTimes(file.duration, effectiveCount(file, count))
}

// Returns the cached JPEG path for frame `index` of `count` evenly spaced frames.
export async function getFrame(file, { index, count, width }) {
  const n = effectiveCount(file, count)
  if (index < 0 || index >= n) throw new HttpError(404, `Frame index out of range (0-${n - 1})`)
  const st = await sourceStat(file)
  const time = getFrameTimes(file, n)[index]
  const out = path.join(config.framesDir, String(file.id), `f_${n}_${width}_${index}.jpg`)
  return render(out, st, [
    ...inputArgs(file, time), '-frames:v', '1',
    '-vf', `scale='min(${width},iw)':-2`, '-q:v', '3',
  ])
}

const even = (n) => Math.max(2, Math.floor(n / 2) * 2)

// Tile geometry so the whole sheet's longest side is <= MAX_SHEET_SIDE.
export function sheetLayout(file, count, cols) {
  const n = effectiveCount(file, count)
  const c = Math.min(Math.max(1, cols), n)
  const rows = Math.ceil(n / c)
  const aspect = (file.height && file.width) ? file.height / file.width : 9 / 16
  let w = Math.floor(MAX_SHEET_SIDE / c)
  let h = w * aspect
  if (rows * h > MAX_SHEET_SIDE) {
    w = w * (MAX_SHEET_SIDE / (rows * h))
    h = w * aspect
  }
  return { count: n, cols: c, rows, tileW: even(w), tileH: even(h) }
}

// A single JPEG grid of evenly spaced frames. Returns { path, times }.
export async function getContactSheet(file, { count, cols }) {
  const st = await sourceStat(file)
  const L = sheetLayout(file, count, cols)
  const times = getFrameTimes(file, L.count)
  const dir = path.join(config.framesDir, String(file.id))
  const sheet = path.join(dir, `sheet_${L.count}_${L.cols}.jpg`)
  if (await fresh(sheet, st)) return { path: sheet, times, layout: L }

  await once(sheet, async () => {
    const tilePath = (i) => path.join(dir, `s_${L.count}_${L.tileW}x${L.tileH}_${i}.jpg`)
    for (let i = 0; i < L.count; i++) {
      await render(tilePath(i), st, [
        ...inputArgs(file, times[i]), '-frames:v', '1',
        '-vf', `scale=${L.tileW}:${L.tileH}`, '-q:v', '3',
      ])
    }
    const tmp = sheet.replace(/\.jpg$/, '.part.jpg')
    await runFfmpeg([
      '-start_number', '0', '-framerate', '1',
      '-i', path.join(dir, `s_${L.count}_${L.tileW}x${L.tileH}_%d.jpg`),
      '-vf', `tile=${L.cols}x${L.rows}`, '-frames:v', '1', '-q:v', '3', tmp,
    ])
    await fs.rename(tmp, sheet)
  })
  return { path: sheet, times, layout: L }
}
