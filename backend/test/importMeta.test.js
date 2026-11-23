import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'fs'
import path from 'path'
import { startTestServer } from './helpers.js'

let t
before(async () => { t = await startTestServer() })
after(async () => { await t.close?.() })

test('buildNotesFromInfo formats LinkedIn-style metadata', async () => {
  const { buildNotesFromInfo } = await import('../src/services/importMeta.js')
  const n = buildNotesFromInfo({
    uploader: 'Jane Doe', webpage_url: 'https://www.linkedin.com/posts/x', extractor_key: 'LinkedIn',
    description: 'Great launch video', title: 'Jane Doe on LinkedIn: Great launch video',
  })
  assert.equal(n, 'Author: Jane Doe\nSource: https://www.linkedin.com/posts/x\nPlatform: LinkedIn\n\nGreat launch video')
  assert.equal(buildNotesFromInfo({}), '')
  assert.match(buildNotesFromInfo({ upload_date: '20250102', title: 'T' }), /Posted: 2025-01-02\nTitle: T/)
})

test('applyImportMeta fills empty notes only and removes the json', async () => {
  const { applyImportMeta } = await import('../src/services/importMeta.js')
  const ins = (name, notes) => t.db.prepare("INSERT INTO files (filepath, filename, file_type, notes) VALUES (?, ?, 'video', ?)")
    .run(path.join(t.mediaDir, name), name, notes).lastInsertRowid
  const a = ins('[abc123] First.mp4', null)
  const b = ins('[def456] Second.mp4', 'my own notes')
  writeFileSync(path.join(t.dataDir, 'abc123.info.json'), JSON.stringify({ id: 'abc123', uploader: 'Ann', description: 'Hello' }))
  writeFileSync(path.join(t.dataDir, 'def456.info.json'), JSON.stringify({ id: 'def456', uploader: 'Bob' }))
  const n = await applyImportMeta(t.db, t.dataDir)
  assert.equal(n, 1)
  assert.match(t.db.prepare('SELECT notes FROM files WHERE id=?').get(a).notes, /Author: Ann/)
  assert.equal(t.db.prepare('SELECT notes FROM files WHERE id=?').get(b).notes, 'my own notes')
})

test('LinkedIn: author, date and full caption come from page JSON-LD (VideoObject.creator)', async () => {
  const { enrichLinkedIn, buildNotesFromInfo, authorFromLinkedInTitle } = await import('../src/services/importMeta.js')
  const ld = { '@type': 'VideoObject', uploadDate: '2026-11-09T14:30:56.520Z', description: 'Full caption here.', creator: { name: 'Marina K', url: 'https://www.linkedin.com/in/marina' } }
  const html = `<html><script type="application/ld+json">${JSON.stringify(ld)}</script></html>`
  const info = await enrichLinkedIn(
    { extractor_key: 'LinkedIn', webpage_url: 'https://www.linkedin.com/feed/update/urn:li:activity:1/', title: 'x', description: 'Full… | 3 comments on LinkedIn' },
    async () => ({ ok: true, text: async () => html }),
  )
  const notes = buildNotesFromInfo(info)
  assert.match(notes, /^Author: Marina K \(https:\/\/www.linkedin.com\/in\/marina\)/)
  assert.match(notes, /Posted: 2026-11-09/)
  assert.match(notes, /Full caption here\.$/)

  // offline: falls back to the title
  const offline = await enrichLinkedIn(
    { extractor_key: 'LinkedIn', webpage_url: 'https://www.linkedin.com/feed/update/x/', title: 'Quick recap. | Marina Kondratenko | 31 comments' },
    async () => { throw new Error('offline') },
  )
  assert.equal(offline.uploader, 'Marina Kondratenko')
  assert.equal(authorFromLinkedInTitle('John Szebegyinszki | Vucko | 21 likes · 1 comment | LinkedIn'), 'John Szebegyinszki')
  assert.equal(authorFromLinkedInTitle('Just a title'), '')
})
