import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex')
let api, port, client
const seen = []

before(async () => {
  api = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body })
      if (req.headers.authorization !== 'Bearer mb_test') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"bad token"}') }
      if (req.url.startsWith('/api/agent/v1/files/7/contact-sheet.jpg')) { res.writeHead(200, { 'content-type': 'image/jpeg', 'x-frame-times': '1.0,2.0' }); return res.end(JPEG) }
      if (req.url === '/api/agent/v1/files/bulk') { res.writeHead(422, { 'content-type': 'application/json' }); return res.end('{"error":"validation failed","errors":[{"index":0,"errors":["unknown tag"]}]}') }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"pending":3}')
    })
  })
  await new Promise((r) => api.listen(0, r))
  port = api.address().port
  client = new Client({ name: 'test', version: '0' })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js')],
    env: { ...process.env, MOTIONBASE_URL: `http://127.0.0.1:${port}`, MOTIONBASE_TOKEN: 'mb_test' },
  }))
})
after(async () => { await client?.close(); api?.close() })

test('lists the tools', async () => {
  const { tools } = await client.listTools()
  const names = tools.map((t) => t.name)
  for (const n of ['motionbase_status', 'motionbase_taxonomy', 'motionbase_view_contact_sheet', 'motionbase_claim_files', 'motionbase_update_files']) assert.ok(names.includes(n), n)
})

test('status calls the API with the bearer token', async () => {
  const r = await client.callTool({ name: 'motionbase_status', arguments: {} })
  assert.match(r.content[0].text, /"pending": 3/)
  assert.equal(seen.at(-1).auth, 'Bearer mb_test')
})

test('contact sheet comes back as an image with timestamps', async () => {
  const r = await client.callTool({ name: 'motionbase_view_contact_sheet', arguments: { id: 7 } })
  assert.equal(r.content[0].type, 'image')
  assert.equal(r.content[0].mimeType, 'image/jpeg')
  assert.equal(Buffer.from(r.content[0].data, 'base64').length, JPEG.length)
  assert.match(r.content[1].text, /1\.0,2\.0/)
})

test('API validation errors are returned to the model, not thrown', async () => {
  const r = await client.callTool({ name: 'motionbase_update_files', arguments: { updates: [{ file_id: 1, add_tags: [{ category: 'X', name: 'Y' }] }], dry_run: true } })
  assert.equal(r.isError, true)
  assert.match(r.content[0].text, /422.*validation failed[\s\S]*unknown tag/)
})
