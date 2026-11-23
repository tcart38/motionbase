import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { startTestServer, addFile } from './helpers.js'

let ctx
before(async () => { ctx = await startTestServer() })
after(() => ctx.close())

test('migration 1 applied', () => {
  assert.ok(ctx.db.pragma('user_version', { simple: true }) >= 1)
  const cols = ctx.db.prepare("PRAGMA table_info(file_tags)").all().map((c) => c.name)
  assert.ok(cols.includes('source'))
})

test('folder CRUD, uniqueness, cycles, delete moves children up', async () => {
  const a = (await ctx.post('/api/folders', { name: 'A' })).data
  const b = (await ctx.post('/api/folders', { name: 'B', parent_id: a.id })).data
  const c = (await ctx.post('/api/folders', { name: 'C', parent_id: b.id })).data

  assert.equal((await ctx.post('/api/folders', { name: 'a' })).status, 409) // NOCASE unique at root
  assert.equal((await ctx.post('/api/folders', { name: 'x/y' })).status, 400)
  assert.equal((await ctx.post('/api/folders', { name: 'Z', parent_id: 9999 })).status, 404)

  // cycle rejection
  assert.equal((await ctx.patch(`/api/folders/${a.id}`, { parent_id: c.id })).status, 422)
  assert.equal((await ctx.patch(`/api/folders/${a.id}`, { parent_id: a.id })).status, 422)

  const f1 = addFile(ctx, 'one.mp4')
  const f2 = addFile(ctx, 'two.mp4')
  const f3 = addFile(ctx, 'three.mp4')
  await ctx.post('/api/files/bulk', { file_ids: [f1], folder_id: b.id })
  await ctx.post('/api/files/bulk', { file_ids: [f2], folder_id: c.id })

  let tree = (await ctx.get('/api/folders')).data
  const byName = Object.fromEntries(tree.folders.map((f) => [f.name, f]))
  assert.equal(byName.A.total_count, 2)
  assert.equal(byName.A.file_count, 0)
  assert.equal(byName.B.file_count, 1)
  assert.equal(byName.B.total_count, 2)
  assert.equal(tree.unfiled_count, 1)
  assert.equal(tree.all_count, 3)

  // filters
  let r = await ctx.get(`/api/files?folder=${a.id}`)
  assert.equal(r.data.total, 0)
  r = await ctx.get(`/api/files?folder=${a.id}&subfolders=1`)
  assert.equal(r.data.total, 2)
  r = await ctx.get('/api/files?folder=none')
  assert.deepEqual(r.data.files.map((f) => f.id), [f3])

  // delete B: C moves up to A, f1 moves to A
  r = await ctx.del(`/api/folders/${b.id}`)
  assert.equal(r.data.moved_folders, 1)
  assert.equal(r.data.moved_files, 1)
  tree = (await ctx.get('/api/folders')).data
  const c2 = tree.folders.find((f) => f.name === 'C')
  assert.equal(c2.parent_id, a.id)
  assert.equal((await ctx.get(`/api/files/${f1}`)).data.folder_id, a.id)

  // rename + move to root
  r = await ctx.patch(`/api/folders/${c.id}`, { name: 'C2', parent_id: null })
  assert.equal(r.data.name, 'C2')
  assert.equal(r.data.parent_id, null)
})

test('bulk is atomic and validates', async () => {
  const f1 = addFile(ctx, 'bulk1.mp4')
  const brand = (await ctx.get('/api/categories')).data.find((c) => c.name === 'Brand')
  const tag = (await ctx.post('/api/tags', { category_id: brand.id, name: 'BulkTag' })).data

  let r = await ctx.post('/api/files/bulk', { file_ids: [f1, 99999], add_tag_ids: [tag.id] })
  assert.equal(r.status, 404)
  assert.equal((await ctx.get(`/api/files/${f1}`)).data.tags.length, 0) // rolled back

  r = await ctx.post('/api/files/bulk', { file_ids: [f1], add_tag_ids: [tag.id], is_favorite: true, mark_reviewed: true })
  assert.equal(r.data.updated, 1)
  const file = (await ctx.get(`/api/files/${f1}`)).data
  assert.equal(file.tags[0].name, 'BulkTag')
  assert.equal(file.is_favorite, 1)
  assert.equal(file.needs_tagging, 0)
  assert.equal(file.reviewed_by, 'user')

  r = await ctx.post('/api/files/bulk', { file_ids: Array.from({ length: 501 }, (_, i) => i + 1) })
  assert.equal(r.status, 413)
  r = await ctx.post('/api/files/bulk', { file_ids: [f1], add_tag_ids: [424242] })
  assert.equal(r.status, 404)
  r = await ctx.post('/api/files/bulk', { file_ids: [f1], folder_id: 424242 })
  assert.equal(r.status, 404)
  r = await ctx.post('/api/files/bulk', { file_ids: [] })
  assert.equal(r.status, 400)
})

test('search matches notes; categories gain selection/description', async () => {
  const id = addFile(ctx, 'notes-target.mp4')
  await ctx.patch(`/api/files/${id}`, { notes: 'kinetic typography reference' })
  const r = await ctx.get('/api/files?search=kinetic')
  assert.deepEqual(r.data.files.map((f) => f.id), [id])

  const c = (await ctx.post('/api/categories', { name: 'Mood', description: 'Overall feel', selection: 'single' })).data
  assert.equal(c.selection, 'single')
  assert.equal(c.description, 'Overall feel')
  assert.equal((await ctx.post('/api/categories', { name: 'Bad', selection: 'x' })).status, 400)
})

test('import-from-disk mirrors directory structure', async () => {
  const dir = path.join(ctx.mediaDir, 'Client', '2024')
  mkdirSync(dir, { recursive: true })
  const fp = path.join(dir, 'disk.mp4')
  writeFileSync(fp, 'x')
  const id = addFile(ctx, 'disk.mp4', { filepath: fp })

  let r = await ctx.post('/api/folders/import-from-disk', { dry_run: true })
  assert.equal(r.data.files_assigned, 1)
  assert.equal((await ctx.get(`/api/files/${id}`)).data.folder_id, null)

  r = await ctx.post('/api/folders/import-from-disk')
  assert.equal(r.data.folders_created, 2)
  const f = (await ctx.get(`/api/files/${id}`)).data
  assert.ok(f.folder_id)
  const tree = (await ctx.get('/api/folders')).data.folders
  assert.ok(tree.find((x) => x.name === '2024' && x.parent_id === tree.find((y) => y.name === 'Client').id))
})

test('delete file removes thumbnail and cached frames', async () => {
  const id = addFile(ctx, 'del.mp4')
  const thumb = path.join(ctx.dataDir, 'thumbnails', `${id}.jpg`)
  mkdirSync(path.dirname(thumb), { recursive: true })
  writeFileSync(thumb, 'x')
  ctx.db.prepare('UPDATE files SET thumbnail_path = ? WHERE id = ?').run(thumb, id)
  const fdir = path.join(ctx.dataDir, 'frames', String(id))
  mkdirSync(fdir, { recursive: true })
  writeFileSync(path.join(fdir, 'f.jpg'), 'x')
  await ctx.del(`/api/files/${id}`)
  const { existsSync } = await import('fs')
  assert.equal(existsSync(thumb), false)
  assert.equal(existsSync(fdir), false)
})
