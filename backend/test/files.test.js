import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer, addFile } from './helpers.js'

let ctx
before(async () => { ctx = await startTestServer() })
after(() => ctx.close())

test('migration runner sets user_version and seeds', () => {
  const cats = ctx.db.prepare('SELECT name FROM tag_categories ORDER BY name').all().map((r) => r.name)
  assert.deepEqual(cats, ['Aspect Ratio', 'Brand', 'Video Type'])
})

test('list, get, tag diff and favorites', async () => {
  const id = addFile(ctx, 'a.mp4')
  const brand = (await ctx.get('/api/categories')).data.find((c) => c.name === 'Brand')
  const t1 = (await ctx.post('/api/tags', { category_id: brand.id, name: 'Acme' })).data
  const t2 = (await ctx.post('/api/tags', { category_id: brand.id, name: 'Globex' })).data

  let r = await ctx.patch(`/api/files/${id}`, { tag_ids: [t1.id], is_favorite: true })
  assert.equal(r.status, 200)
  assert.deepEqual(r.data.tags.map((t) => t.name), ['Acme'])
  assert.equal(r.data.is_favorite, 1)

  r = await ctx.patch(`/api/files/${id}`, { tag_ids: [t2.id] })
  assert.deepEqual(r.data.tags.map((t) => t.name), ['Globex'])

  r = await ctx.get(`/api/files?tags=${t2.id}`)
  assert.equal(r.data.total, 1)
  assert.equal(r.data.files[0].tags[0].name, 'Globex')

  r = await ctx.get('/api/files/99999')
  assert.equal(r.status, 404)
})

test('inbox view, counts, status and agent-source filters', async () => {
  const a = addFile(ctx, 'inbox-a.mp4')
  const b = addFile(ctx, 'inbox-b.mp4')
  const before = (await ctx.get('/api/files/counts')).data
  assert.equal(before.inbox, before.total - (await ctx.get('/api/files?status=reviewed&limit=1')).data.total)

  await ctx.post('/api/files/bulk', { file_ids: [a], mark_reviewed: true })
  const after = (await ctx.get('/api/files/counts')).data
  assert.equal(after.inbox, before.inbox - 1)

  const inbox = (await ctx.get('/api/files?view=inbox&limit=500')).data
  assert.ok(inbox.files.some((f) => f.id === b))
  assert.ok(!inbox.files.some((f) => f.id === a))
  assert.equal((await ctx.get('/api/files?status=pending&limit=1')).status, 200)

  const brand = (await ctx.get('/api/categories')).data.find((c) => c.name === 'Brand')
  const t = (await ctx.post('/api/tags', { category_id: brand.id, name: 'AgentTagged' })).data
  ctx.db.prepare("INSERT INTO file_tags (file_id, tag_id, source) VALUES (?, ?, 'agent')").run(b, t.id)
  const ai = (await ctx.get('/api/files?source=agent')).data
  assert.deepEqual(ai.files.map((f) => f.id), [b])
  const next = (await ctx.get(`/api/files/${b}/next?source=agent`)).data
  assert.equal(next.nextId, b)
})
