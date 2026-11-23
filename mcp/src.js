import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] })
const fail = (msg) => ({ isError: true, content: [{ type: 'text', text: msg }] })

/**
 * Thin MCP wrapper over the MotionBase Agent API. `env` supplies MOTIONBASE_URL and MOTIONBASE_TOKEN;
 * `fetchImpl` is injectable for tests.
 */
export function createServer(env = process.env, fetchImpl = fetch) {
  const base = String(env.MOTIONBASE_URL || 'http://localhost:3001').replace(/\/+$/, '').replace(/\/api\/agent\/v1$/, '') + '/api/agent/v1'
  const token = env.MOTIONBASE_TOKEN

  async function call(method, path, { query, body, binary } = {}) {
    if (!token) throw new Error('MOTIONBASE_TOKEN is not set. Create a token in MotionBase under Settings > Agent API.')
    const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])) : ''
    let res
    try {
      res = await fetchImpl(base + path + qs, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120000),
      })
    } catch (err) {
      throw new Error(`Could not reach MotionBase at ${base}: ${err.message}`)
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      const detail = data.errors ? `\n${JSON.stringify(data.errors, null, 2)}` : ''
      throw new Error(`MotionBase returned ${res.status}: ${data.error || res.statusText}${detail}`)
    }
    if (binary) return { data: Buffer.from(await res.arrayBuffer()), headers: res.headers, type: res.headers.get('content-type') || 'image/jpeg' }
    return res.json()
  }

  const server = new McpServer({ name: 'motionbase', version: '2.0.0' })
  const tool = (name, description, shape, handler) =>
    server.registerTool(name, { description, inputSchema: shape }, async (args) => {
      try { return await handler(args) } catch (err) { return fail(err.message) }
    })

  tool('motionbase_status',
    'Start here. Counts of pending / needs-review / reviewed / untagged videos in the MotionBase library, and whether frame extraction is available.',
    {}, async () => text(await call('GET', '/status')))

  tool('motionbase_taxonomy',
    "Read the user's rules: every category (with description and whether it allows one tag or many), its tags, and the folder tree. Read this before tagging and prefer existing tags.",
    {}, async () => text(await call('GET', '/taxonomy')))

  tool('motionbase_list_files',
    'List videos. status: pending (untouched), untagged, needs_review (AI-reviewed, awaiting the user), reviewed, all. Paginated: pass next_cursor back as cursor.',
    {
      status: z.enum(['pending', 'untagged', 'needs_review', 'reviewed', 'agent_reviewed', 'all']).optional(),
      folder: z.string().optional().describe('Folder id, folder path like "Brands/Acme", or "none" for unfiled'),
      search: z.string().optional().describe('Matches filename or notes'),
      tags: z.string().optional().describe('Comma-separated tag ids'),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    },
    async (a) => text(await call('GET', '/files', { query: a })))

  tool('motionbase_get_file', 'Full details for one video: tags by category, notes, folder, review state, duration, size.',
    { id: z.number().int() }, async ({ id }) => text(await call('GET', `/files/${id}`)))

  tool('motionbase_view_contact_sheet',
    'See a video: returns ONE image tiling evenly spaced frames (reading order, left to right, top to bottom) plus the timestamp of each tile. Use this to decide what a video is.',
    { id: z.number().int(), count: z.number().int().min(1).max(16).optional().describe('Frames, default 9'), cols: z.number().int().min(1).max(8).optional() },
    async ({ id, count, cols }) => {
      const r = await call('GET', `/files/${id}/contact-sheet.jpg`, { query: { count: count ?? 9, cols }, binary: true })
      const times = r.headers.get('x-frame-times')
      return { content: [
        { type: 'image', data: r.data.toString('base64'), mimeType: r.type.split(';')[0] },
        { type: 'text', text: times ? `Tile timestamps (seconds): ${times}` : `Contact sheet for file ${id}` },
      ] }
    })

  tool('motionbase_view_frame',
    'Look closer: one full frame of a video (index counts from 0 within `count` evenly spaced frames).',
    { id: z.number().int(), index: z.number().int().min(0).max(15), count: z.number().int().min(1).max(16).optional(), width: z.number().int().min(64).max(1024).optional() },
    async ({ id, index, count, width }) => {
      const r = await call('GET', `/files/${id}/frames/${index}.jpg`, { query: { count: count ?? 8, width: width ?? 768 }, binary: true })
      return { content: [{ type: 'image', data: r.data.toString('base64'), mimeType: r.type.split(';')[0] }] }
    })

  tool('motionbase_claim_files',
    'Claim a batch of videos to work on (leased so other agents skip them). Returns the files. Release anything you do not finish.',
    { limit: z.number().int().min(1).max(100).optional().describe('default 10'), status: z.enum(['pending', 'untagged', 'needs_review']).optional(), lease_seconds: z.number().int().min(30).max(3600).optional(), owner: z.string().optional() },
    async (a) => text(await call('POST', '/queue/claim', { body: a })))

  tool('motionbase_release_files', 'Release claimed videos you are not going to finish (omit file_ids to release everything you hold).',
    { file_ids: z.array(z.number().int()).optional() },
    async (a) => text(await call('POST', '/queue/release', { body: a })))

  const update = z.object({
    file_id: z.number().int(),
    set_category_tags: z.record(z.string(), z.array(z.string())).optional().describe('{"Video Type": ["Explainer"]} replaces only that category (empty array clears)'),
    add_tags: z.array(z.object({ category: z.string(), name: z.string() })).optional(),
    remove_tags: z.array(z.object({ category: z.string(), name: z.string() })).optional(),
    add_tag_ids: z.array(z.number().int()).optional(),
    remove_tag_ids: z.array(z.number().int()).optional(),
    notes: z.string().nullable().optional(),
    notes_mode: z.enum(['replace', 'append']).optional(),
    folder_path: z.string().optional().describe('e.g. "Brands/Acme"'),
    folder_id: z.number().int().nullable().optional(),
    favorite: z.boolean().optional(),
    mark_reviewed: z.boolean().optional().describe('Only when confident; otherwise leave pending with a note'),
  })
  tool('motionbase_update_files',
    'Tag, annotate, file and mark reviewed up to 500 videos in one all-or-nothing call. ALWAYS run once with dry_run:true first and check the result. Returns an activity_id the user can use to undo.',
    { updates: z.array(update).min(1).max(500), create_missing: z.boolean().optional().describe('Create unknown categories/tags/folders instead of failing'), dry_run: z.boolean().optional() },
    async (a) => text(await call('POST', '/files/bulk', { body: a })))

  tool('motionbase_create',
    'Create a category, tag or folder (idempotent). Prefer existing ones; give new tags a short description.',
    {
      kind: z.enum(['category', 'tag', 'folder']),
      name: z.string().optional().describe('Category/tag name'),
      category: z.string().optional().describe('For a tag: the category name'),
      description: z.string().optional(),
      selection: z.enum(['single', 'multi']).optional().describe('For a category'),
      path: z.string().optional().describe('For a folder: "Parent/Child"'),
    },
    async ({ kind, ...rest }) => {
      const path = { category: '/categories', tag: '/tags', folder: '/folders' }[kind]
      return text(await call('POST', path, { body: rest }))
    })

  tool('motionbase_recent_activity', 'Recent changes agents made (ids can be reverted by the user in MotionBase).',
    { limit: z.number().int().min(1).max(100).optional() },
    async (a) => text(await call('GET', '/activity', { query: a })))

  return server
}
