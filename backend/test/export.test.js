import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'
import { startTestServer, addFile } from './helpers.js'
import { readZip } from './zipReader.js'

let t
const ids = {}
const text = (r) => r.data.toString('utf8')

// Minimal RFC4180 parser for assertions.
function parseCsv(s) {
  s = s.replace(/^﻿/, '')
  const rows = []; let row = [], cell = '', q = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\r' && s[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++ }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}
const asObjects = (rows) => rows.slice(1).map((r) => Object.fromEntries(rows[0].map((h, i) => [h, r[i]])))

const tagId = (cat, name) => t.db.prepare('SELECT t.id FROM tags t JOIN tag_categories c ON c.id=t.category_id WHERE c.name=? AND t.name=?').get(cat, name).id
const link = (fileId, cat, name, source = 'user') => t.db.prepare('INSERT INTO file_tags (file_id, tag_id, source) VALUES (?,?,?)').run(fileId, tagId(cat, name), source)

before(async () => {
  t = await startTestServer()
  const db = t.db
  const cat = db.prepare("INSERT INTO tag_categories (name, is_system, description, selection) VALUES (?, 0, ?, ?)")
  db.prepare("UPDATE tag_categories SET description='Which brand', selection='single' WHERE name='Brand'").run()
  cat.run('Mood', null, 'multi'); cat.run('notes', null, 'multi')
  const catId = (n) => db.prepare('SELECT id FROM tag_categories WHERE name=?').get(n).id
  const tag = db.prepare('INSERT INTO tags (category_id, name, description) VALUES (?,?,?)')
  tag.run(catId('Brand'), 'Acme', 'The Acme brand'); tag.run(catId('Brand'), 'Globex', null)
  tag.run(catId('Mood'), 'Calm', null); tag.run(catId('Mood'), 'Loud, fast', null)
  tag.run(catId('notes'), 'x', null)
  db.prepare("INSERT INTO folders (name, position) VALUES ('Campaigns', 0)").run()
  const camp = db.prepare("SELECT id FROM folders WHERE name='Campaigns'").get().id
  db.prepare("INSERT INTO folders (parent_id, name, position) VALUES (?, 'Spring', 0)").run(camp)
  db.prepare("INSERT INTO folders (name, position) VALUES ('Empty', 1)").run()
  const spring = db.prepare("SELECT id FROM folders WHERE name='Spring'").get().id

  mkdirSync(path.join(t.mediaDir, 'sub'))
  ids.a = addFile(t, 'a.mp4', { folder_id: spring, file_size: 1, is_favorite: 1, notes: '=HYPERLINK("http://evil","x")', fps: 30, aspect_ratio: '16:9', reviewed_at: '2026-01-01 00:00:00', reviewed_by: 'user', needs_tagging: 0 })
  ids.b = addFile(t, 'b "quoted", name.mp4', { notes: 'Author: Jane Doe (https://example.com/jane)\nSource: https://example.com/post/1\nPlatform: X\n\nmulti\nline "text"', file_size: 1 })
  ids.c = addFile(t, 'c.mp4', { filepath: path.join(t.mediaDir, 'sub', 'c.mp4'), file_size: 1 })
  writeFileSync(path.join(t.mediaDir, 'sub', 'c.mp4'), 'x')
  ids.trashed = addFile(t, 'gone.mp4', { deleted_at: '2026-02-01 00:00:00', file_size: 1 })
  ids.missing = addFile(t, 'missing.mp4', { is_missing: 1, file_size: 1 })
  // same filename as a.mp4 but in the same folder -> zip entry collision
  ids.dup = addFile(t, 'dup-src.mp4', { folder_id: spring, file_size: 1 })
  t.db.prepare("UPDATE files SET filename='a.mp4' WHERE id=?").run(ids.dup)
  link(ids.a, 'Brand', 'Acme'); link(ids.a, 'Mood', 'Calm'); link(ids.a, 'Mood', 'Loud, fast', 'agent')
  link(ids.b, 'Brand', 'Globex'); link(ids.c, 'notes', 'x')
  link(ids.trashed, 'Brand', 'Acme')
  t.db.prepare("INSERT INTO file_events (file_id, action, actor_label, detail_json) VALUES (?, 'tags_changed', 'Someone', '{\"x\":1}')").run(ids.a)
})
after(() => t.close())

test('csvCell: RFC4180 quoting and formula-injection guard', async () => {
  const { csvCell, csvRow } = await import('../src/services/exporter.js')
  assert.equal(csvCell('plain'), 'plain')
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell('l1\nl2'), '"l1\nl2"')
  for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) assert.ok(csvCell(bad).replace(/^"/, '').startsWith("'"), bad)
  assert.equal(csvCell("=A1,B1"), `"'=A1,B1"`)
  assert.equal(csvCell(-5), '-5')           // real numbers are not text
  assert.equal(csvCell(true), '1')
  assert.equal(csvCell(null), '')
  assert.equal(csvRow(['a', 'b']), 'a,b\r\n')
})

test('parseNotes reads Author/Source lines written by URL import', async () => {
  const { parseNotes } = await import('../src/services/exporter.js')
  assert.deepEqual(parseNotes('Author: Jane (https://x.y/z)\nSource: https://a.b/c\n\ncaption'), { source_url: 'https://a.b/c', author: 'Jane' })
  assert.deepEqual(parseNotes('just notes'), { source_url: null, author: null })
})

test('metadata CSV: columns, per-category columns, escaping, injection, trash', async () => {
  const r = await t.get('/api/export/metadata?format=csv')
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type'), /text\/csv/)
  assert.match(r.headers.get('content-disposition'), /attachment; filename="motionbase-metadata-\d{4}-\d\d-\d\d\.csv"/)
  const body = text(r)
  assert.ok(body.startsWith('﻿'))
  assert.ok(body.includes('\r\n'))
  const rows = parseCsv(body)
  const header = rows[0]
  assert.deepEqual(header.slice(0, 5), ['id', 'filename', 'relative_path', 'folder_path', 'file_type'])
  for (const h of ['duration_seconds', 'file_size_bytes', 'uploaded_by', 'upload_source', 'favorite', 'reviewed', 'reviewed_by', 'notes', 'source_url', 'author', 'tags']) assert.ok(header.includes(h), h)
  // categories become columns (system Aspect Ratio does not; clashing name 'notes' is disambiguated)
  assert.ok(header.includes('Brand') && header.includes('Mood'))
  assert.ok(header.includes('notes (tags)'))
  assert.ok(!header.includes('Aspect Ratio'))
  const objs = asObjects(rows)
  const byName = (n) => objs.filter((o) => o.filename === n)
  assert.equal(objs.length, 4) // a, dup, b, c; trashed + missing excluded
  assert.ok(!objs.some((o) => o.filename === 'gone.mp4' || o.filename === 'missing.mp4'))
  const a = objs.find((o) => o.id === String(ids.a))
  assert.equal(a.relative_path, 'a.mp4')
  assert.equal(a.folder_path, 'Campaigns/Spring')
  assert.equal(a.favorite, '1')
  assert.equal(a.reviewed, '1')
  assert.equal(a.notes, `'=HYPERLINK("http://evil","x")`)
  assert.equal(a.Brand, 'Acme')
  assert.equal(a.Mood, 'Calm; Loud, fast')
  assert.equal(a.tags, 'Brand: Acme; Mood: Calm; Mood: Loud, fast')
  assert.equal(a.fps, '30')
  const b = byName('b "quoted", name.mp4')[0]
  assert.equal(b.author, 'Jane Doe')
  assert.equal(b.source_url, 'https://example.com/post/1')
  assert.match(b.notes, /multi\nline "text"$/)
  assert.equal(objs.find((o) => o.id === String(ids.c)).relative_path, 'sub/c.mp4')

  const withTrash = asObjects(parseCsv(text(await t.get('/api/export/metadata?format=csv&include_trash=1'))))
  assert.equal(withTrash.length, 5)
  assert.equal(withTrash.find((o) => o.filename === 'gone.mp4').in_trash, '1')
})

test('metadata JSON: shape, categories, folders, history flag, trash', async () => {
  const j = (await t.get('/api/export/metadata?format=json')).data
  assert.ok(j.exported_at && j.motionbase_version)
  const brand = j.categories.find((c) => c.name === 'Brand')
  assert.equal(brand.description, 'Which brand')
  assert.equal(brand.selection, 'single')
  assert.deepEqual(brand.tags.map((x) => x.name), ['Acme', 'Globex'])
  assert.equal(brand.tags[0].description, 'The Acme brand')
  assert.deepEqual(j.folders, ['Campaigns', 'Campaigns/Spring', 'Empty'])
  assert.equal(j.files.length, 4)
  const a = j.files.find((f) => f.id === ids.a)
  assert.deepEqual(a.tags.map((x) => [x.category, x.name, x.source]), [['Brand', 'Acme', 'user'], ['Mood', 'Calm', 'user'], ['Mood', 'Loud, fast', 'agent']])
  assert.equal(a.favorite, true)
  assert.equal(a.history, undefined)
  const h = (await t.get('/api/export/metadata?format=json&include_history=1')).data
  assert.equal(h.files.find((f) => f.id === ids.a).history[0].action, 'tags_changed')
  assert.equal((await t.get('/api/export/metadata?format=json&include_trash=1')).data.files.length, 5)
  assert.equal((await t.get('/api/export/metadata?format=xml')).status, 400)
})

test('download.zip: layout, de-duplicated names, metadata, README, stored videos', async () => {
  const r = await t.get('/api/export/download.zip')
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'application/zip')
  const z = readZip(r.data)
  assert.deepEqual(z.names.filter((n) => n.startsWith('videos/')).sort(), [
    'videos/Campaigns/Spring/a (2).mp4', 'videos/Campaigns/Spring/a.mp4',
    'videos/b "quoted", name.mp4', 'videos/sub/c.mp4'.replace('sub/', ''),
  ].sort())
  for (const n of ['metadata.csv', 'metadata.json', 'README.txt']) assert.ok(z.names.includes(n), n)
  assert.ok(!z.names.some((n) => /gone|missing|\.db|cookies/.test(n)))
  assert.equal(z.entries.get('videos/Campaigns/Spring/a.mp4').method, 0) // stored, not deflated
  assert.equal(z.read('videos/Campaigns/Spring/a.mp4').toString(), 'x')
  assert.equal(JSON.parse(z.read('metadata.json')).files.length, 4)
  assert.match(z.read('metadata.csv').toString(), /^﻿id,filename/)
  assert.match(z.read('README.txt').toString(), /Restoring/)
  const trash = readZip((await t.get('/api/export/download.zip?include_trash=1')).data)
  assert.ok(trash.names.includes('videos/gone.mp4'))
})

test('download.zip lists missing files in the README and keeps going', async () => {
  const id = addFile(t, 'vanishing.mp4', { file_size: 1 })
  const { rmSync } = await import('fs')
  rmSync(path.join(t.mediaDir, 'vanishing.mp4'))
  const z = readZip((await t.get('/api/export/download.zip')).data)
  assert.ok(!z.names.includes('videos/vanishing.mp4'))
  const readme = z.read('README.txt').toString()
  assert.match(readme, /Skipped files \(1\)/)
  assert.match(readme, /vanishing\.mp4 {2}\(missing on disk\)/)
  assert.ok(z.names.includes('videos/c.mp4') || z.names.includes('videos/sub/c.mp4'))
  t.db.prepare('DELETE FROM files WHERE id = ?').run(id)
})

test('ZIP64 archives are readable (forced)', async () => {
  const { ZipSink } = await import('../src/services/exportSinks.js')
  const { PassThrough } = await import('stream')
  const { Readable } = await import('stream')
  const dest = new PassThrough(); const chunks = []; dest.on('data', (c) => chunks.push(c))
  const sink = new ZipSink(dest, { forceZip64: true })
  await sink.addFile('videos/x.mp4', Readable.from([Buffer.from('hello')]))
  await sink.addText('README.txt', 'hi')
  await sink.finish()
  const z = readZip(Buffer.concat(chunks))
  assert.equal(z.zip64, true)
  assert.equal(z.read('videos/x.mp4').toString(), 'hello')
})

test('restore round-trip: export, wipe tags/notes/folders, import, state equals original', async () => {
  const snapshot = () => ({
    files: t.db.prepare(`SELECT id, notes, is_favorite, reviewed_at, reviewed_by, needs_tagging,
      (SELECT group_concat(x, '|') FROM (SELECT c.name||':'||tg.name||':'||ft.source AS x FROM file_tags ft JOIN tags tg ON tg.id=ft.tag_id JOIN tag_categories c ON c.id=tg.category_id WHERE ft.file_id=f.id AND c.is_system=0 ORDER BY 1)) AS tags,
      (SELECT name FROM folders WHERE id = f.folder_id) AS folder FROM files f WHERE deleted_at IS NULL AND is_missing = 0 ORDER BY id`).all(),
    folders: t.db.prepare('SELECT name, (SELECT name FROM folders p WHERE p.id=f.parent_id) AS parent FROM folders f ORDER BY name').all(),
    cats: t.db.prepare('SELECT name, description, selection FROM tag_categories WHERE is_system = 0 ORDER BY name').all(),
    tags: t.db.prepare('SELECT c.name AS c, t.name, t.description FROM tags t JOIN tag_categories c ON c.id=t.category_id WHERE c.is_system=0 ORDER BY 1,2').all(),
  })
  const original = snapshot()
  const exported = (await t.get('/api/export/metadata?format=json')).data

  // wipe
  t.db.exec(`DELETE FROM file_tags WHERE tag_id IN (SELECT t.id FROM tags t JOIN tag_categories c ON c.id=t.category_id WHERE c.is_system=0);
    DELETE FROM tags WHERE category_id IN (SELECT id FROM tag_categories WHERE is_system=0);
    DELETE FROM tag_categories WHERE is_system=0;
    UPDATE files SET notes=NULL, is_favorite=0, reviewed_at=NULL, reviewed_by=NULL, needs_tagging=1, folder_id=NULL;
    DELETE FROM folders;`)
  assert.notDeepEqual(snapshot(), original)

  // dry run writes nothing but reports
  const dry = await t.post('/api/import/metadata?dry_run=1', exported)
  assert.equal(dry.status, 200)
  assert.equal(dry.data.dry_run, true)
  assert.equal(dry.data.matched, 4)
  assert.ok(dry.data.tags_added >= 5 && dry.data.folders_created === 3 && dry.data.notes_set === 2)
  assert.equal(snapshot().folders.length, 0)
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM tag_categories WHERE is_system=0').get().n, 0)

  const real = await t.post('/api/import/metadata', exported)
  assert.equal(real.status, 200)
  assert.equal(real.data.matched, 4)
  assert.equal(real.data.matched_by_path, 4)
  assert.equal(real.data.unmatched_count, 0)
  assert.equal(real.data.tags_added, dry.data.tags_added)
  assert.equal(real.data.categories_created, 4)
  assert.equal(real.data.notes_set, 2)
  assert.equal(real.data.favorites_set, 1)
  assert.equal(real.data.reviewed_set, 1)
  assert.deepEqual(snapshot(), original)
  assert.ok(t.db.prepare("SELECT 1 FROM file_events WHERE file_id=? AND action='metadata_imported'").get(ids.a))

  // idempotent
  const again = (await t.post('/api/import/metadata', exported)).data
  assert.equal(again.tags_added + again.notes_set + again.folders_set + again.favorites_set + again.reviewed_set, 0)
})

test('restore: notes only fill empty unless overwrite_notes=1; unmatched are reported; name+size fallback', async () => {
  t.db.prepare("UPDATE files SET notes='mine' WHERE id=?").run(ids.b)
  const doc = { files: [
    { relative_path: 'b "quoted", name.mp4', filename: 'b "quoted", name.mp4', notes: 'from export' },
    { relative_path: 'moved/c.mp4', filename: 'c.mp4', file_size_bytes: 1, favorite: true },   // matched by filename+size
    { relative_path: '../../etc/passwd', filename: 'passwd', notes: 'x' },                       // never matched
    { relative_path: 'nope.mp4', filename: 'nope.mp4' },
  ] }
  const r1 = (await t.post('/api/import/metadata', doc)).data
  assert.equal(r1.notes_set, 0); assert.equal(r1.notes_skipped, 1)
  assert.equal(r1.matched, 2); assert.equal(r1.matched_by_name_size, 1)
  assert.deepEqual(r1.unmatched, ['../../etc/passwd', 'nope.mp4'])
  assert.equal(t.db.prepare('SELECT notes FROM files WHERE id=?').get(ids.b).notes, 'mine')
  const r2 = (await t.post('/api/import/metadata?overwrite_notes=1', doc)).data
  assert.equal(r2.notes_set, 1)
  assert.equal(t.db.prepare('SELECT notes FROM files WHERE id=?').get(ids.b).notes, 'from export')
  assert.equal((await t.post('/api/import/metadata', { nope: 1 })).status, 400)
  assert.equal((await t.post('/api/import/metadata', { files: [] })).status, 200)
})

test('restore accepts bodies over the 2mb default limit', async () => {
  const files = Array.from({ length: 30000 }, (_, i) => ({ relative_path: `x/${i}.mp4`, filename: `${i}.mp4`, notes: 'n'.repeat(60) }))
  const r = await t.post('/api/import/metadata?dry_run=1', { files })
  assert.equal(r.status, 200)
  assert.equal(r.data.unmatched_count, 30000)
  assert.equal(r.data.unmatched.length, 50)
})

test('client abort stops a streaming download', async () => {
  const { hooks } = await import('../src/services/exporter.js')
  for (let i = 0; i < 40; i++) addFile(t, `abort${i}.mp4`, { file_size: 1 })
  let calls = 0
  hooks.beforeFile = async () => { calls++; await new Promise((r) => setTimeout(r, 25)) }
  try {
    const ac = new AbortController()
    const p = fetch(t.baseUrl + '/api/export/download.zip', { signal: ac.signal }).then((r) => r.arrayBuffer()).catch((e) => e.name)
    await new Promise((r) => setTimeout(r, 200))
    ac.abort()
    assert.equal(await p, 'AbortError')
    await new Promise((r) => setTimeout(r, 100))
    const seen = calls
    await new Promise((r) => setTimeout(r, 300))
    assert.equal(calls, seen, 'work continued after the client went away')
    assert.ok(calls < 40)
  } finally { hooks.beforeFile = null }
})
