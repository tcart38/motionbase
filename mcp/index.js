#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './src.js'

if (!process.env.MOTIONBASE_TOKEN) {
  console.error('motionbase-mcp: set MOTIONBASE_TOKEN (create one in MotionBase under Settings > Agent API) and optionally MOTIONBASE_URL (default http://localhost:3001).')
}
await createServer().connect(new StdioServerTransport())
