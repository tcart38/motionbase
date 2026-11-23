import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { applyBaseSchema } from '../src/db/schema.js'
import { migrations, runMigrations } from '../src/db/migrations.js'
import { autoGroupImports } from '../src/db/migrations/006-media-groups.js'
import { groupImportedFiles, postGroupTitle, captionSnippet } from '../src/services/groups.js'
import { startTestServer, addFile } from './helpers.js'

// ---- migration auto-grouping ---------------------------------------------------------------------

test('migration 6 groups existing multi-item imports, keeps data, is idempotent', () => {
  const db = new Database(':memory:')
  applyBaseSchema(db)
  for (const m of migrations.filter((x) => x.version <= 5)) db.transaction(() => { m.up(db); db.pragma(`user_version = ${m.version}`) })()
  const add = (name, extra = '') => db.prepare(`INSERT INTO files (filepath, filename, file_type, notes) VALUES (?, ?, 'video', ?)`).run('/m/' + name, name, extra || null)
  // post A: 3 items inserted out of order; post B: only one item (stays alone); plain files; post C with 2
  add('[7530619949187248128-3] Reel behind the scenes (3 of 3).mp4', 'keep me')
  add('[7530619949187248128-1] Reel behind the scenes (1 of 3).mp4')
  add('[7530619949187248128-2] Reel behind the scenes (2 of 3).mp4')
  add('[7111111111111111111-1] Lonely (1 of 2).mp4')
  add('plain.mp4')
  add('[9999999999-1] Another (1 of 2).mp4')
  add('[9999999999-2] Another (2 of 2).mp4')

  runMigrations(db, { backup: false })
  const rows = db.prepare('SELECT filename, group_id, group_position, notes FROM files ORDER BY id').all()
  const a = rows.filter((r) => r.filename.startsWith('[7530'))
  assert.equal(new Set(a.map((r) => r.group_id)).size, 1)
  assert.ok(a[0].group_id)
  assert.deepEqual(a.map((r) => r.group_position), [2, 0, 1])
  assert.equal(a[0].notes, 'keep me')
  assert.equal(rows.find((r) => r.filename.startsWith('[7111')).group_id, null)
  assert.equal(rows.find((r) => r.filename === 'plain.mp4').group_id, null)
  const titles = db.prepare('SELECT title FROM media_groups ORDER BY id').all().map((g) => g.title)
  assert.deepEqual(titles, ['Reel behind the scenes', 'Another'])
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM files').get().n, 7)

  assert.equal(autoGroupImports(db), 0) // idempotent
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media_groups').get().n, 2)
  db.close()
})

// ---- API --------------------------------------------------------------------------------------------

let t, A
const PW = 'correct horse battery'
before(async () => {
  t = await startTestServer()
  const setup = await t.post('/api/auth/setup', { username: 'admin', display_name: 'Ada Admin', password: PW })
  A = { Cookie: setup.headers.get('set-cookie').split(';')[0] }
})
after(() => t.close())

const mk = (name, extra) => addFile(t, name, extra)
const list = async (qs = '') => (await t.get(`/api/files?${qs}`, A)).data
const hist = async (id) => (await t.get(`/api/files/${id}/history`, A)).data.events.map((e) => e.action)

test('group CRUD, ordering, events and auto-dissolve', async () => {
  const [a, b, c] = [mk('g1.mp4', { notes: 'Author: Jo\nSource: https://x.test/p\n\nCaption for the clips https://lnkd.in/x' }), mk('g2.mp4'), mk('g3.mp4')]
  assert.equal((await t.post('/api/groups', { file_ids: [a] }, A)).status, 400)
  assert.equal((await t.post('/api/groups', { file_ids: [a, 99999] }, A)).status, 404)

  const created = await t.post('/api/groups', { file_ids: [b, a] }, A)
  assert.equal(created.status, 201)
  const g = created.data
  assert.equal(g.title, 'g2.mp4') // first file has no caption -> filename
  assert.deepEqual(g.members.map((m) => m.id), [b, a])
  assert.equal(g.size, 2)
  assert.ok((await hist(a)).includes('grouped'))

  const one = (await t.get(`/api/files/${a}`, A)).data
  assert.equal(one.group_id, g.id); assert.equal(one.group_size, 2); assert.equal(one.group_title, 'g2.mp4'); assert.equal(one.group_position, 1)

  // caption default
  const cap = (await t.post('/api/groups', { file_ids: [a, c] }, A)).data // a moves out of g (g dissolves: only b left)
  assert.equal(cap.title, 'Caption for the clips')
  assert.equal((await t.get(`/api/groups/${g.id}`, A)).status, 404)
  assert.equal((await t.get(`/api/files/${b}`, A)).data.group_id, null)
  assert.ok((await hist(b)).includes('ungrouped'))

  // rename + reorder
  const r = await t.patch(`/api/groups/${cap.id}`, { title: '  New   name ', order: [c, a] }, A)
  assert.equal(r.data.title, 'New name')
  assert.deepEqual(r.data.members.map((m) => m.id), [c, a])
  assert.ok((await hist(a)).includes('group_renamed'))
  assert.equal((await t.patch(`/api/groups/${cap.id}`, { order: [b] }, A)).status, 400)
  assert.equal((await t.patch(`/api/groups/${cap.id}`, {}, A)).status, 400)
  assert.equal((await t.patch(`/api/groups/${cap.id}`, { title: ' ' }, A)).status, 400)

  // add / remove
  const add = await t.post(`/api/groups/${cap.id}/add`, { file_ids: [b] }, A)
  assert.equal(add.data.added, 1)
  assert.deepEqual(add.data.group.members.map((m) => m.id), [c, a, b])
  const rem = await t.post(`/api/groups/${cap.id}/remove`, { file_ids: [a] }, A)
  assert.equal(rem.data.removed, 1)
  assert.equal(rem.data.group.size, 2)
  const rem2 = await t.post(`/api/groups/${cap.id}/remove`, { file_ids: [b] }, A)
  assert.equal(rem2.data.group, null) // auto-dissolved
  assert.equal((await t.get(`/api/files/${c}`, A)).data.group_id, null)

  // ungroup
  const g2 = (await t.post('/api/groups', { file_ids: [a, b, c], title: 'Trio' }, A)).data
  const un = await t.post(`/api/groups/${g2.id}/ungroup`, {}, A)
  assert.equal(un.data.ungrouped, 3)
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM media_groups WHERE id = ?').get(g2.id).n, 0)
  assert.equal((await t.post(`/api/groups/${g2.id}/ungroup`, {}, A)).status, 404)
  assert.ok((await hist(c)).includes('ungrouped'))
})

test('collapse: one row per group, filters/search/sort/pagination stay correct', async () => {
  const brand = t.db.prepare("SELECT id FROM tag_categories WHERE name = 'Brand'").get().id
  const tag = (await t.post('/api/tags', { category_id: brand, name: 'CollapseTag' }, A)).data
  const m1 = mk('c-one.mp4', { date_added: '2026-01-01 00:00:00', duration: 5 })
  const m2 = mk('c-two.mp4', { date_added: '2026-01-02 00:00:00', duration: 6 })
  const m3 = mk('c-three.mp4', { date_added: '2026-01-03 00:00:00', duration: 7 })
  const s1 = mk('c-solo1.mp4', { date_added: '2026-01-04 00:00:00' })
  const s2 = mk('c-solo2.mp4', { date_added: '2026-01-05 00:00:00' })
  const g = (await t.post('/api/groups', { file_ids: [m2, m1, m3], title: 'Collapsed trio' }, A)).data
  await t.patch(`/api/files/${m3}`, { tag_ids: [tag.id], notes: 'zebra' }, A)

  const all = await list('search=c-&collapse=1&sort=date_added&order=asc')
  assert.equal(all.total, 3)
  assert.deepEqual(all.files.map((f) => f.id), [m2, s1, s2]) // representative = first member by position (m2), dated 01-02
  assert.equal(all.files[0].group_size, 3); assert.equal(all.files[0].group_title, 'Collapsed trio')
  assert.equal(all.files[1].group_size, null)
  // no collapse: unchanged, every file
  assert.equal((await list('search=c-')).total, 5)

  // only the last member matches the tag: the group still appears, represented by that member
  const tagged = await list(`tags=${tag.id}&collapse=1`)
  assert.equal(tagged.total, 1); assert.equal(tagged.files[0].id, m3); assert.equal(tagged.files[0].group_size, 3)
  const z = await list('search=zebra&collapse=1')
  assert.equal(z.total, 1); assert.equal(z.files[0].id, m3)
  assert.equal((await list('search=zebra')).total, 1)

  // pagination counts entries
  const p1 = await list('search=c-&collapse=1&limit=2&page=1&sort=date_added&order=desc')
  const p2 = await list('search=c-&collapse=1&limit=2&page=2&sort=date_added&order=desc')
  assert.equal(p1.total, 3); assert.equal(p2.total, 3)
  assert.deepEqual([...p1.files, ...p2.files].map((f) => f.id), [s2, s1, m2])
  // sort by filename / duration run on the representative
  assert.deepEqual((await list('search=c-&collapse=1&sort=filename&order=asc')).files.map((f) => f.id), [s1, s2, m2])
  // favorite filter only on a non-representative member still shows the group
  await t.patch(`/api/files/${m1}`, { is_favorite: true }, A)
  const fav = await list('favorites=1&collapse=1&search=c-')
  assert.equal(fav.total, 1); assert.equal(fav.files[0].id, m1)

  // group filter returns members in group order, incl. total
  const members = await list(`group=${g.id}`)
  assert.deepEqual(members.files.map((f) => f.id), [m2, m1, m3])

  // trashing a member keeps the group; size counts live members
  await t.post('/api/files/trash', { file_ids: [m1] }, A)
  const after1 = await list('search=c-&collapse=1&sort=date_added&order=asc')
  assert.equal(after1.total, 3)
  assert.equal(after1.files[0].group_size, 2)
  assert.equal((await t.get(`/api/files/${m2}`, A)).data.group_size, 2)
  await t.post('/api/files/trash', { file_ids: [m1], deleted: false }, A)
  assert.equal((await t.get(`/api/files/${m2}`, A)).data.group_size, 3)
  // trash view is never collapsed
  await t.post('/api/files/trash', { file_ids: [m2, m3] }, A)
  assert.equal((await list('trash=1&search=c-')).total, 2)

  // /next with collapse skips the rest of the group
  await t.post('/api/files/trash', { file_ids: [m2, m3], deleted: false }, A)
  const nxt = async (id, qs = '') => (await t.get(`/api/files/${id}/next?search=c-&sort=date_added&order=asc${qs}`, A)).data
  assert.equal((await nxt(m2, '&collapse=1')).nextId, s1)
  assert.equal((await nxt(m3, '&collapse=1')).nextId, s1) // another member: continues after the group entry
  assert.equal((await nxt(m2, '&collapse=1')).total, 3)
  assert.equal((await nxt(m2)).nextId, m3)
  assert.equal((await nxt(s2, '&collapse=1')).nextId, m2) // wraps
})

test('expand_groups on bulk and trash; history events', async () => {
  const x = mk('e1.mp4'), y = mk('e2.mp4'), z = mk('e3.mp4'), solo = mk('e4.mp4')
  await t.post('/api/groups', { file_ids: [x, y, z], title: 'E' }, A)
  await t.post('/api/files/trash', { file_ids: [z] }, A) // trashed member is not touched by expansion

  const plain = await t.post('/api/files/bulk', { file_ids: [x], is_favorite: true }, A)
  assert.equal(plain.data.updated, 1)
  const exp = await t.post('/api/files/bulk', { file_ids: [x, solo], is_favorite: false, expand_groups: true }, A)
  assert.equal(exp.data.updated, 3) // x, y, solo (z trashed)
  assert.deepEqual(exp.data.file_ids.sort(), [x, y, solo].sort())
  assert.ok((await hist(y)).includes('favorite_changed') === false) // y was never favorited before; unchanged -> no event
  await t.post('/api/files/bulk', { file_ids: [x], is_favorite: true, expand_groups: true }, A)
  assert.ok((await hist(y)).includes('favorite_changed'))

  const tr = await t.post('/api/files/trash', { file_ids: [x], expand_groups: true }, A)
  assert.equal(tr.data.updated, 2)
  assert.deepEqual(tr.data.file_ids.sort(), [x, y].sort())
  assert.ok((await hist(y)).includes('trashed'))
  // restore expands over the group's trashed members (incl. z)
  const rs = await t.post('/api/files/trash', { file_ids: [x], deleted: false, expand_groups: true }, A)
  assert.equal(rs.data.updated, 3)
  assert.equal((await t.get(`/api/files/${z}`, A)).data.deleted_at, null)
})

test('purging members dissolves a group left with one file', async () => {
  const p = mk('pp1.mp4'), q = mk('pp2.mp4')
  const g = (await t.post('/api/groups', { file_ids: [p, q] }, A)).data
  await t.post('/api/files/trash', { file_ids: [q] }, A)
  assert.equal((await t.get(`/api/files/${p}`, A)).data.group_size, 1)
  await t.post('/api/files/purge', { file_ids: [q] }, A)
  assert.equal((await t.get(`/api/files/${p}`, A)).data.group_id, null)
  assert.equal((await t.get(`/api/groups/${g.id}`, A)).status, 404)
})

test('import: a multi-item post becomes one group', () => {
  const names = ['[7530619949187248128-1] Cap (1 of 3).mp4', '[7530619949187248128-2] Cap (2 of 3).mp4', '[7530619949187248128-3] Cap (3 of 3).mp4']
  const ids = names.map((n) => mk(n))
  const title = postGroupTitle({ author: 'Jane Example', description: 'Behind the scenes of our new reel.\n\nFull project https://lnkd.in/x' })
  assert.equal(title, 'Jane Example: Behind the scenes of our new reel.')
  const gid = groupImportedFiles(t.db, names, { title, by: { user_id: null, token_id: null, label: 'x' }, userId: null })
  assert.ok(gid)
  const rows = ids.map((id) => t.db.prepare('SELECT group_id, group_position FROM files WHERE id = ?').get(id))
  assert.deepEqual(rows.map((r) => r.group_position), [0, 1, 2])
  assert.ok(rows.every((r) => r.group_id === gid))
  assert.equal(t.db.prepare('SELECT title FROM media_groups WHERE id = ?').get(gid).title, title)
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM file_events WHERE action = 'grouped' AND file_id = ?").get(ids[0]).n, 1)
  assert.equal(groupImportedFiles(t.db, [names[0]], { title }), null) // < 2 ungrouped files -> nothing
  assert.equal(captionSnippet('Author: A\nSource: s\n\nItem 2 of 3 in this post'), '')
})

test('export carries group_title/position and restore re-creates groups', async () => {
  const a = mk('r1.mp4', { file_size: 1 }), b = mk('r2.mp4', { file_size: 2 }), c = mk('r3.mp4', { file_size: 3 })
  await t.post('/api/groups', { file_ids: [b, a], title: 'Round trip' }, A)
  const doc = (await t.get('/api/export/metadata?format=json', A)).data
  const rec = (n) => doc.files.find((f) => f.filename === n)
  assert.equal(rec('r2.mp4').group_title, 'Round trip'); assert.equal(rec('r2.mp4').group_position, 0)
  assert.equal(rec('r1.mp4').group_position, 1)
  assert.equal(rec('r3.mp4').group_title, null)
  const csv = (await t.get('/api/export/metadata?format=csv', A)).data.toString()
  assert.match(csv.split('\r\n')[0], /group_title,group_position/)

  await t.post(`/api/groups/${(await t.get(`/api/files/${a}`, A)).data.group_id}/ungroup`, {}, A)
  const dry = (await t.post('/api/import/metadata?dry_run=1', doc, A)).data
  assert.equal(dry.groups_created >= 1, true)
  assert.equal((await t.get(`/api/files/${a}`, A)).data.group_id, null) // dry run changed nothing
  await t.post('/api/import/metadata', doc, A)
  const ga = (await t.get(`/api/files/${a}`, A)).data, gb = (await t.get(`/api/files/${b}`, A)).data
  assert.ok(ga.group_id && ga.group_id === gb.group_id)
  assert.equal(ga.group_title, 'Round trip')
  assert.equal(gb.group_position, 0); assert.equal(ga.group_position, 1)
  assert.equal((await t.get(`/api/files/${c}`, A)).data.group_id, null)
  // idempotent: files already grouped are left alone
  const again = (await t.post('/api/import/metadata', doc, A)).data
  assert.equal(again.groups_created, 0)
})

test('agent API files expose group fields and stay uncollapsed', async () => {
  const tok = (await t.post('/api/tokens', { name: 'agent', scopes: ['read', 'write'] }, A)).data
  const token = tok.token || tok.secret
  const H = { Authorization: `Bearer ${token}` }
  const a = mk('ag1.mp4'), b = mk('ag2.mp4')
  const g = (await t.post('/api/groups', { file_ids: [a, b], title: 'Agent grp' }, A)).data
  const r = await t.get(`/api/agent/v1/files/${b}`, H)
  assert.equal(r.status, 200)
  assert.equal(r.data.group_id, g.id); assert.equal(r.data.group_title, 'Agent grp'); assert.equal(r.data.group_position, 1); assert.equal(r.data.group_size, 2)
  const l = await t.get('/api/agent/v1/files?limit=500', H)
  const names = l.data.files.map((f) => f.filename)
  assert.ok(names.includes('ag1.mp4') && names.includes('ag2.mp4'))
  const plain = (await t.get(`/api/agent/v1/files/${mk('ag3.mp4')}`, H)).data
  assert.equal(plain.group_id, null); assert.equal(plain.group_size, null)
})
