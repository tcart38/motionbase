import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer } from './src.js'

/**
 * Serve one MCP request over streamable HTTP (stateless: a fresh server per request, no sessions).
 * `baseUrl` is where the MotionBase Agent API lives (the server itself) and `token` the caller's bearer
 * token, which is forwarded so every tool call runs with the caller's own permissions and audit trail.
 */
export async function handleMcpHttp(req, res, { baseUrl, token }) {
  const server = createServer({ MOTIONBASE_URL: baseUrl, MOTIONBASE_TOKEN: token })
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => { transport.close(); server.close() })
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
}
