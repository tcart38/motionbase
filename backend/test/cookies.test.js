import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { startTestServer } from './helpers.js'

let ctx
before(async () => { ctx = await startTestServer() })
after(() => ctx.close())

test('cookies endpoint is mounted and manages data/cookies.txt', async () => {
  assert.deepEqual((await ctx.get('/api/cookies')).data, { hasCookies: false })
  assert.equal((await ctx.post('/api/cookies', {})).status, 400)

  const content = '# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tFALSE\t0\tk\tv\n'
  assert.equal((await ctx.post('/api/cookies', { content })).status, 200)
  const file = path.join(ctx.dataDir, 'cookies.txt')
  assert.equal(readFileSync(file, 'utf8'), content)
  assert.deepEqual((await ctx.get('/api/cookies')).data, { hasCookies: true })

  const { buildYtdlpArgs } = await import('../src/routes/import.js')
  const withCookies = buildYtdlpArgs('https://example.com/v')
  assert.equal(withCookies[withCookies.indexOf('--cookies') + 1], file)
  assert.equal(withCookies.at(-1), 'https://example.com/v')

  assert.equal((await ctx.del('/api/cookies')).status, 200)
  assert.equal(existsSync(file), false)
  assert.ok(!buildYtdlpArgs('https://example.com/v').includes('--cookies'))
})
