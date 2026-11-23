// Destinations for an export: a streamed zip (archiver) or a plain folder copy.
import archiver from 'archiver'
import { once } from 'events'
import { createWriteStream, promises as fs } from 'fs'
import { finished, pipeline } from 'stream/promises'
import { Readable } from 'stream'
import path from 'path'

const abortError = () => Object.assign(new Error('Export cancelled'), { name: 'AbortError' })

export const ZIP64_THRESHOLD = 3.5 * 1024 ** 3

// Streams a zip into `dest` (a response or a file stream). Videos are stored (not compressed:
// they are already compressed), metadata is deflated. Entries are added one at a time and the
// next one waits for the previous to be written, so memory stays flat and a slow client
// applies backpressure to the disk reads.
export class ZipSink {
  constructor(dest, { forceZip64 = false, signal } = {}) {
    this.dest = dest
    this.signal = signal
    this.archive = archiver('zip', { zlib: { level: 6 }, forceZip64 })
    this.archive.on('warning', () => {})
    this.destDone = finished(dest)
    this.destDone.catch(() => {})
    this.aborted = new Promise((_, rej) => {
      if (signal?.aborted) return rej(abortError())
      signal?.addEventListener('abort', () => { this.archive.abort(); rej(abortError()) }, { once: true })
    })
    this.aborted.catch(() => {})
    this.archive.pipe(dest)
  }

  async _add(readable, opts) {
    const entry = once(this.archive, 'entry')
    entry.catch(() => {})
    this.archive.append(readable, opts)
    await Promise.race([entry, this.aborted])
  }

  addFile(name, readable, { date } = {}) { return this._add(readable, { name, store: true, date }) }
  addStream(name, readable) { return this._add(readable, { name }) }
  addText(name, text) { return this._add(Buffer.from(text, 'utf8'), { name }) }

  async finish() {
    this.archive.finalize()
    await Promise.race([this.destDone, this.aborted])
  }

  abort() {
    this.archive.abort()
    this.dest.destroy()
  }
}

// Copies into a directory, same relative structure as the zip. Existing files are never overwritten.
export class FolderSink {
  constructor(root, { signal } = {}) {
    this.root = path.resolve(root)
    this.signal = signal
  }

  _target(name) {
    const target = path.resolve(this.root, name)
    if (target !== this.root && !target.startsWith(this.root + path.sep)) throw new Error('Refusing to write outside the export folder')
    return target
  }

  async addFile(name, readable, { date } = {}) {
    const target = this._target(name)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await pipeline(readable, createWriteStream(target, { flags: 'wx' }), { signal: this.signal })
    if (date) await fs.utimes(target, date, date).catch(() => {})
  }

  addStream(name, readable) { return this.addFile(name, readable) }
  addText(name, text) { return this.addFile(name, Readable.from([Buffer.from(text, 'utf8')])) }
  async finish() {}
  abort() {}
}
