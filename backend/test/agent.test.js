import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, addFile } from './helpers.js'

let ctx, H
const ENV_TOKEN = 'env-token-for-tests'
before(async () => {
  ctx = await startTestServer({ AGENT_API_TOKEN: ENV_TOKEN })
  const t = (await ctx.post('/api/tokens', { name: 'test-agent' })).data
  H = { Authorization: `Bearer ${t.token}` }
})
after(() => ctx.close())

const A = '/api/agent/v1'
const get = (u) => ctx.get(A + u, H)
const post = (u, b) => ctx.post(A + u, b, H)
const patch = (u, b) => ctx.patch(A + u, b, H)

test('auth: tokens hashed, shown once, revocable; env token works', async () => {
  assert.equal((await ctx.get(`${A}/status`)).status, 401)
  assert.equal((await ctx.get(`${A}/status`, { Authorization: 'Bearer nope' })).status, 401)

  const created = (await ctx.post('/api/tokens', { name: 'x' })).data
  assert.match(created.token, /^mb_[A-Za-z0-9_-]{43}$/)
  const row = ctx.db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(created.id)
  assert.notEqual(row.token_hash, created.token)
  assert.equal(row.token_hash.length, 64)
  const list = (await ctx.get('/api/tokens')).data
  assert.ok(list.every((t) => t.token === undefined && t.token_hash === undefined))

  const h = { Authorization: `Bearer ${created.token}` }
  assert.equal((await ctx.get(`${A}/status`, h)).status, 200)
  assert.ok(ctx.db.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?').get(created.id).last_used_at)
  await ctx.del(`/api/tokens/${created.id}`)
  assert.equal((await ctx.get(`${A}/status`, h)).status, 401)

  assert.equal((await ctx.get(`${A}/status`, { Authorization: `Bearer ${ENV_TOKEN}` })).status, 200)
  // discovery is public
  assert.equal((await ctx.get(`${A}/`)).status, 200)
  assert.equal((await ctx.get(`${A}/openapi.json`)).data.openapi, '3.1.0')
})

test('idempotent taxonomy creation and taxonomy listing', async () => {
  let r = await post('/categories', { name: 'Mood', description: 'Overall feel', selection: 'single' })
  assert.equal(r.status, 201); assert.equal(r.data.created, true)
  r = await post('/categories', { name: 'mood' })
  assert.equal(r.status, 200); assert.equal(r.data.created, false)

  r = await post('/tags', { category: 'Mood', name: 'Calm' })
  assert.equal(r.data.created, true)
  r = await post('/tags', { category: 'Mood', name: 'calm' })
  assert.equal(r.data.created, false)
  assert.equal((await post('/tags', { category: 'Aspect Ratio', name: 'x' })).status, 403)
  assert.equal((await post('/tags', { category: 'Nope', name: 'x' })).status, 404)

  r = await post('/folders', { path: 'Brands/Acme' })
  assert.equal(r.data.created, true)
  assert.equal(r.data.folder.path, 'Brands/Acme')
  r = await post('/folders', { path: 'brands/acme' })
  assert.equal(r.data.created, false)

  const tax = (await get('/taxonomy')).data
  const mood = tax.categories.find((c) => c.name === 'Mood')
  assert.equal(mood.selection, 'single')
  assert.equal(mood.tags[0].name, 'Calm')
  assert.equal(tax.categories.find((c) => c.name === 'Aspect Ratio').is_system, true)
  assert.ok(tax.folders.find((f) => f.path === 'Brands/Acme'))
})

test('bulk: validate-all-then-apply, create_missing, dry_run, system protection, single-select', async () => {
  const f1 = addFile(ctx, 'b1.mp4'), f2 = addFile(ctx, 'b2.mp4')
  const ar = ctx.db.prepare("SELECT t.id FROM tags t JOIN tag_categories c ON c.id=t.category_id WHERE c.name='Aspect Ratio' AND t.name='16:9'").get().id
  ctx.db.prepare("INSERT INTO file_tags (file_id, tag_id, source) VALUES (?, ?, 'system')").run(f1, ar)

  // one bad item -> 422 and nothing applied
  let r = await post('/files/bulk', { updates: [
    { file_id: f1, add_tags: [{ category: 'Video Type', name: 'Explainer' }] },
    { file_id: f2, add_tag_ids: [ar] },
    { file_id: 999999, notes: 'x' },
    { file_id: f2, bogus: 1 },
  ] })
  assert.equal(r.status, 422)
  assert.deepEqual(r.data.errors.map((e) => e.index), [0, 1, 2, 3])
  assert.match(r.data.errors[0].errors[0], /create_missing/)
  assert.match(r.data.errors[1].errors[0], /system-managed/)
  assert.equal((await get(`/files/${f1}`)).data.tags.length, 1) // only system tag

  // missing taxonomy without create_missing
  r = await post('/files/bulk', { updates: [{ file_id: f1, add_tags: [{ category: 'Video Type', name: 'Explainer' }] }] })
  assert.equal(r.status, 422)
  assert.match(r.data.errors[0].errors[0], /create_missing/)

  // dry run writes nothing, not even taxonomy
  r = await post('/files/bulk', { dry_run: true, create_missing: true, updates: [
    { file_id: f1, set_category_tags: { 'Video Type': ['Explainer'], Brand: ['Acme'] }, folder_path: 'New/Place' },
  ] })
  assert.equal(r.status, 200)
  assert.deepEqual(r.data.created.tags.sort(), ['Brand/Acme', 'Video Type/Explainer'])
  assert.deepEqual(r.data.created.folders, ['New/Place'])
  assert.equal(r.data.results[0].changed, true)
  assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM tags WHERE name='Explainer'").get().n, 0)
  assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM folders WHERE name='New'").get().n, 0)
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM agent_activity').get().n, 3) // only taxonomy creates so far

  // real apply
  r = await post('/files/bulk', { create_missing: true, updates: [
    { file_id: f1, set_category_tags: { 'Video Type': ['Explainer'] }, folder_path: 'New/Place', notes: 'first', favorite: true },
    { file_id: f2, add_tags: [{ category: 'Brand', name: 'Acme' }], notes: 'hello' },
  ] })
  assert.equal(r.status, 200)
  assert.equal(r.data.applied, 2)
  let file = (await get(`/files/${f1}`)).data
  assert.deepEqual(file.tags_by_category['Video Type'], ['Explainer'])
  assert.deepEqual(file.tags_by_category['Aspect Ratio'], ['16:9']) // system preserved
  assert.equal(file.folder_path, 'New/Place')
  assert.equal(file.is_favorite, true)
  assert.equal(file.tags.find((t) => t.name === 'Explainer').source, 'agent')
  assert.equal(file.tags.find((t) => t.name === '16:9').source, 'system')

  // set_category_tags replaces only that category
  await post('/files/bulk', { updates: [{ file_id: f1, add_tags: [{ category: 'Brand', name: 'Acme' }] }] })
  await post('/files/bulk', { create_missing: true, updates: [{ file_id: f1, set_category_tags: { 'Video Type': ['Tutorial'] } }] })
  file = (await get(`/files/${f1}`)).data
  assert.deepEqual(file.tags_by_category['Video Type'], ['Tutorial'])
  assert.deepEqual(file.tags_by_category.Brand, ['Acme'])

  // notes append
  await patch(`/files/${f2}`, { notes: 'more', notes_mode: 'append' })
  assert.equal((await get(`/files/${f2}`)).data.notes, 'hello\n\nmore')

  // single-select enforcement
  r = await post('/files/bulk', { updates: [{ file_id: f1, add_tags: [{ category: 'Mood', name: 'Calm' }] }] })
  assert.equal(r.status, 200)
  await post('/tags', { category: 'Mood', name: 'Tense' })
  r = await post('/files/bulk', { updates: [{ file_id: f1, add_tags: [{ category: 'Mood', name: 'Tense' }] }] })
  assert.equal(r.status, 422)
  assert.match(r.data.errors[0].errors[0], /single-select/)
  r = await post('/files/bulk', { updates: [{ file_id: f1, set_category_tags: { Mood: 'Tense' } }] })
  assert.equal(r.status, 200)

  // limits
  r = await post('/files/bulk', { updates: Array.from({ length: 501 }, () => ({ file_id: f1 })) })
  assert.equal(r.status, 413)
  assert.equal((await post('/files/bulk', { updates: [] })).status, 400)
})

test('activity log and revert', async () => {
  const f = addFile(ctx, 'rev.mp4')
  const before = (await get(`/files/${f}`)).data
  const r = await post('/files/bulk', { create_missing: true, updates: [
    { file_id: f, set_category_tags: { 'Video Type': ['Revertable'] }, notes: 'agent note', folder_path: 'Rev' },
  ] })
  const id = r.data.activity_id
  assert.ok(id)
  let file = (await get(`/files/${f}`)).data
  assert.equal(file.notes, 'agent note')

  const act = (await get('/activity')).data.activity.find((a) => a.id === id)
  assert.equal(act.revertable, true)
  assert.equal((await ctx.get(`/api/activity/${id}`)).data.before[f].notes, null)

  const rv = await ctx.post(`/api/activity/${id}/revert`)
  assert.equal(rv.status, 200)
  file = (await get(`/files/${f}`)).data
  assert.equal(file.notes, before.notes)
  assert.equal(file.folder_id, null)
  assert.deepEqual(file.tags, [])
  assert.equal((await ctx.post(`/api/activity/${id}/revert`)).status, 409)
  assert.equal((await ctx.post('/api/activity/999999/revert')).status, 404)
  // taxonomy-create entries cannot be reverted
  const tcreate = (await get('/activity?limit=200')).data.activity.find((a) => a.action.startsWith('taxonomy.'))
  assert.equal((await ctx.post(`/api/activity/${tcreate.id}/revert`)).status, 422)
})

test('review workflow honours agent_requires_confirmation', async () => {
  const f1 = addFile(ctx, 'rv1.mp4'), f2 = addFile(ctx, 'rv2.mp4')
  let r = await post('/files/review', { file_ids: [f1] })
  assert.equal(r.data.applied, 1)
  let file = (await get(`/files/${f1}`)).data
  assert.equal(file.review.status, 'reviewed')
  assert.equal(file.review.reviewed_by, 'agent:test-agent')
  assert.ok(file.review.agent_reviewed_at)
  assert.equal(file.review.needs_tagging, false)

  assert.equal((await ctx.api('PUT', '/api/settings', { agent_requires_confirmation: 'yes' })).status, 400)
  await ctx.api('PUT', '/api/settings', { agent_requires_confirmation: true })
  assert.equal((await get('/status')).data.requires_confirmation, true)
  await post('/files/review', { file_ids: [f2] })
  file = (await get(`/files/${f2}`)).data
  assert.equal(file.review.status, 'needs_review')
  assert.equal(file.review.needs_tagging, true) // still in the user's inbox
  const list = (await get('/files?status=needs_review')).data
  assert.deepEqual(list.files.map((x) => x.id), [f2])
  assert.equal((await get('/files?status=agent_reviewed')).data.total >= 2, true)

  // user confirms
  await ctx.patch(`/api/files/${f2}`, { mark_reviewed: true })
  assert.equal((await get(`/files/${f2}`)).data.review.status, 'reviewed')
  await ctx.api('PUT', '/api/settings', { agent_requires_confirmation: false })
})

test('file listing: status filters, folder path, cursor pagination', async () => {
  const ids = [1, 2, 3, 4, 5].map((i) => addFile(ctx, `pg${i}.mp4`))
  await post('/folders', { path: 'Pg/Sub' })
  await post('/files/apply', { file_ids: ids.slice(0, 3), folder_path: 'Pg/Sub' })

  let r = (await get('/files?folder=Pg&limit=2')).data
  assert.equal(r.total, 3)
  assert.equal(r.files.length, 2)
  assert.ok(r.next_cursor)
  const r2 = (await get(`/files?folder=Pg&limit=2&cursor=${r.next_cursor}`)).data
  assert.equal(r2.files.length, 1)
  assert.equal(r2.next_cursor, null)
  assert.equal((await get('/files?folder=Pg&subfolders=0')).data.total, 0)
  assert.equal((await get('/files?folder=Missing/Path')).status, 404)
  assert.equal((await get('/files?status=bogus')).status, 400)
  assert.equal((await get('/files?limit=abc')).status, 400)

  const untagged = (await get('/files?status=untagged&limit=200')).data
  assert.ok(untagged.files.some((f) => ids.includes(f.id)))
  const status = (await get('/status')).data
  assert.ok(status.counts.pending > 0)
})

test('queue leases: claim, exclusion, release, expiry', async () => {
  ctx.db.exec('UPDATE files SET reviewed_at = datetime(\'now\')') // clear queue
  const ids = [1, 2, 3, 4].map((i) => addFile(ctx, `q${i}.mp4`))
  let c1 = (await post('/queue/claim', { limit: 3, lease_seconds: 60 })).data
  assert.equal(c1.files.length, 3)
  assert.ok(c1.files.every((f) => f.lease?.owner === 'test-agent'))
  const c2 = (await post('/queue/claim', { limit: 3 })).data
  assert.equal(c2.files.length, 1) // only the unleased one is left
  const c3 = (await post('/queue/claim', { limit: 3 })).data
  assert.equal(c3.files.length, 0)

  const rel = (await post('/queue/release', { file_ids: [c1.files[0].id] })).data
  assert.equal(rel.released, 1)
  assert.equal((await post('/queue/claim', { limit: 5 })).data.files.length, 1)

  // expired leases are reclaimable
  ctx.db.prepare("UPDATE files SET lease_until = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(ids[0])
  assert.equal((await post('/queue/claim', { limit: 5 })).data.files.length, 1)

  // reviewing releases the lease
  await post('/files/review', { file_ids: [c1.files[1].id] })
  assert.equal(ctx.db.prepare('SELECT lease_owner FROM files WHERE id = ?').get(c1.files[1].id).lease_owner, null)
  assert.equal((await post('/queue/release', {})).data.released >= 1, true)
  assert.equal((await post('/queue/claim', { status: 'all' })).status, 400)
})

test('openapi document is in sync with docs/openapi.json', async () => {
  const { readFileSync } = await import('fs')
  const { buildOpenApi } = await import('../src/agent/openapi.js')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const spec = buildOpenApi(pkg.version)
  const served = (await ctx.get(`${A}/openapi.json`)).data
  assert.deepEqual(served, spec)
  for (const p of ['/files/bulk', '/queue/claim', '/files/{id}/contact-sheet.jpg']) assert.ok(spec.paths[p])
  let onDisk
  try { onDisk = JSON.parse(readFileSync(new URL('../../docs/openapi.json', import.meta.url), 'utf8')) } catch {}
  if (onDisk) assert.deepEqual(onDisk, spec, 'docs/openapi.json is stale: run `npm run openapi`')
})
