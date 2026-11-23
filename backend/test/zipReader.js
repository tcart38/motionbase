// Minimal zip central-directory reader for tests (stored + deflate, zip64 aware).
import { inflateRawSync } from 'zlib'

export function readZip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 70000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip (no end of central directory)')
  let count = buf.readUInt16LE(eocd + 10)
  let cdOffset = buf.readUInt32LE(eocd + 16)
  let zip64 = false
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50) {
    zip64 = true
    const rec = Number(buf.readBigUInt64LE(eocd - 20 + 8))
    count = Number(buf.readBigUInt64LE(rec + 32))
    cdOffset = Number(buf.readBigUInt64LE(rec + 48))
  }
  const entries = new Map()
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory')
    const method = buf.readUInt16LE(p + 10)
    let csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24)
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32)
    let off = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nlen)
    let q = p + 46 + nlen
    const end = q + elen
    while (q + 4 <= end) {
      const id = buf.readUInt16LE(q), len = buf.readUInt16LE(q + 2)
      if (id === 1) {
        let r = q + 4
        if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(r)); r += 8 }
        if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(r)); r += 8 }
        if (off === 0xffffffff) { off = Number(buf.readBigUInt64LE(r)); r += 8 }
      }
      q += 4 + len
    }
    entries.set(name, { name, method, csize, usize, off })
    p = end + clen
  }
  const read = (name) => {
    const e = entries.get(name)
    if (!e) throw new Error(`no entry ${name}`)
    const start = e.off + 30 + buf.readUInt16LE(e.off + 26) + buf.readUInt16LE(e.off + 28)
    const data = buf.subarray(start, start + e.csize)
    return e.method === 8 ? inflateRawSync(data) : Buffer.from(data)
  }
  return { names: [...entries.keys()], entries, read, zip64 }
}
