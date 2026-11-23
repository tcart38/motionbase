import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from './helpers.js'

let ctx, H
before(async () => {
  ctx = await startTestServer()
  process.env.PORT = new URL(ctx.baseUrl).port // the MCP endpoint calls the Agent API on this server
  const t = (await ctx.post('/api/tokens', { name: 'mcp-http' })).data
  H = { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
})
after(() => ctx.close())

async function rpc(method, params, headers = H, id = 1) {
  const res = await fetch(`${ctx.baseUrl}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })
  const raw = await res.text()
  const data = raw.startsWith('event:') || raw.includes('\ndata:') || raw.startsWith('data:')
    ? JSON.parse(raw.split('\n').find((l) => l.startsWith('data:')).slice(5))
    : raw ? JSON.parse(raw) : null
  return { status: res.status, data }
}

test('/mcp requires a valid bearer token', async () => {
  const { status } = await rpc('tools/list', {}, { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' })
  assert.equal(status, 401)
  const bad = await rpc('tools/list', {}, { ...H, Authorization: 'Bearer nope' })
  assert.equal(bad.status, 401)
})

test('/mcp lists tools and runs one through the Agent API with the caller token', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } })
  assert.equal(init.status, 200)
  const list = await rpc('tools/list', {}, H, 2)
  assert.ok(list.data.result.tools.some((t) => t.name === 'motionbase_status'))
  const call = await rpc('tools/call', { name: 'motionbase_status', arguments: {} }, H, 3)
  assert.ok(!call.data.result.isError, JSON.stringify(call.data))
  assert.match(call.data.result.content[0].text, /"agent": "mcp-http"/)
})

test('/mcp GET is not allowed (stateless)', async () => {
  const res = await fetch(`${ctx.baseUrl}/mcp`, { headers: H })
  assert.equal(res.status, 405)
})
