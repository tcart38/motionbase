import { Router } from 'express'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { config } from '../config.js'
import { agentAuth } from '../middleware/agentAuth.js'

// MCP over streamable HTTP at /mcp, same bearer tokens as the Agent API. The MCP server code lives in /mcp
// (next to backend/ in the repo, at /app/mcp in the Docker image) and is loaded lazily.
const here = path.dirname(fileURLToPath(import.meta.url))
const candidates = [path.join(here, '../../mcp/http.js'), path.join(here, '../../../mcp/http.js')]

let loader
function load() {
  loader ??= (async () => {
    const file = candidates.find((f) => existsSync(f))
    if (!file) throw new Error('MCP server files not found')
    return import(pathToFileURL(file).href)
  })()
  return loader
}

const router = Router()

router.post('/', agentAuth, async (req, res, next) => {
  try {
    const { handleMcpHttp } = await load()
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')[1]
    await handleMcpHttp(req, res, { baseUrl: `http://127.0.0.1:${config.port}`, token })
  } catch (err) {
    if (res.headersSent) return
    if (/not found|Cannot find/i.test(err.message)) return res.status(501).json({ error: 'MCP server is not installed in this build (run npm install in mcp/)' })
    next(err)
  }
})

// Stateless server: no SSE stream to open and no session to close.
const notAllowed = (req, res) => res.status(405).set('Allow', 'POST').json({
  jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. POST JSON-RPC to /mcp.' }, id: null,
})
router.get('/', notAllowed)
router.delete('/', notAllowed)

export default router
