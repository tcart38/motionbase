import React, { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { RiFileCopyLine, RiBookOpenLine } from '@remixicon/react'
import { Button } from '@/components/ui/button.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'

function Code({ children, label = 'Copy' }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(children); toast.success('Copied') } catch { toast.error('Could not copy') }
  }
  return (
    <div className="relative">
      <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 pr-12 text-xs leading-relaxed whitespace-pre-wrap break-words"><code>{children}</code></pre>
      <Button size="icon-sm" variant="outline" className="absolute right-2 top-2" onClick={copy} aria-label={label} title={label}><RiFileCopyLine /></Button>
    </div>
  )
}

const CAN = [
  ['See what needs doing', 'Counts of pending, needs-review, untagged and reviewed videos; list and search videos by status, folder, tag, filename or notes.'],
  ['Look at each video', 'Evenly spaced frames and a contact-sheet image per video, so a vision model can see what it is, plus duration, size, fps and existing tags and notes.'],
  ['Read your rules', 'Your categories, tags and folders, including the descriptions you wrote for them, and which categories allow only one tag.'],
  ['Tag and categorize', 'Add, remove or replace tags (per category), create missing categories, tags and folders, in batches of up to 500 videos at a time.'],
  ['Write notes and file videos', 'Set or append notes, move videos into folders, favorite them, and mark them reviewed.'],
  ['Work in parallel', 'Claim batches of videos with a time-limited lease so several agents never do the same video.'],
  ['Undo', 'Every change is logged with a before-and-after snapshot you can revert below.'],
]
const CANNOT = [
  'Delete, rename or move files on disk, and it cannot see or touch anything in the Trash.',
  'Change the automatic "Aspect Ratio" tags.',
  'Create, view or revoke API tokens, change settings or revert the activity log (those are only in this app).',
]

const ENDPOINTS = [
  ['GET', '/status', 'Counts by status, leased files, ffmpeg availability'],
  ['GET', '/taxonomy', 'Categories (with descriptions, single/multi), tags, folders'],
  ['GET', '/files', 'List files: status, folder, tags, search, favorites, limit, cursor'],
  ['GET', '/files/:id', 'One file with tags, notes, folder and review state'],
  ['GET', '/files/:id/contact-sheet.jpg', 'One image with up to 16 frames (?count=9&cols=3)'],
  ['GET', '/files/:id/frames', 'Frame timestamps and URLs; /frames/:i.jpg returns one frame'],
  ['PATCH', '/files/:id', 'Update one file (tags, notes, folder, favorite, mark_reviewed)'],
  ['POST', '/files/bulk', 'Different updates for many files, all-or-nothing, dry_run supported'],
  ['POST', '/files/apply', 'The same change for many files'],
  ['POST', '/files/review', 'Mark files reviewed'],
  ['POST', '/categories, /tags, /folders', 'Create (idempotent)'],
  ['POST', '/queue/claim, /queue/release', 'Lease and release batches of work'],
  ['GET', '/activity', 'What agents changed (revert from the UI)'],
]

export default function AgentDocs() {
  const [tab, setTab] = useState('overview')
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001'
  const api = `${base}/api/agent/v1`

  const quick = useMemo(() => `export MB=${api}
export TOKEN=mb_xxxxxxxx   # create one under "API tokens" above
AUTH="Authorization: Bearer $TOKEN"

# 1. What is waiting, and what are the rules?
curl -H "$AUTH" $MB/status
curl -H "$AUTH" $MB/taxonomy

# 2. Look at a video
curl -H "$AUTH" "$MB/files?status=pending&limit=5"
curl -H "$AUTH" "$MB/files/42/contact-sheet.jpg?count=9&cols=3" -o sheet.jpg

# 3. Preview a change (nothing is written), then apply it
curl -H "$AUTH" -H 'Content-Type: application/json' -X POST $MB/files/bulk -d '{
  "dry_run": true, "create_missing": true,
  "updates": [{
    "file_id": 42,
    "set_category_tags": {"Video Type": ["Explainer"]},
    "add_tags": [{"category": "Brand", "name": "Acme"}],
    "notes": "Clean isometric explainer with a smooth title card.",
    "folder_path": "Brands/Acme",
    "mark_reviewed": true
  }]
}'
# Send the same request without "dry_run" to apply it. The response has an activity_id you can revert in this app.`, [api])

  const mcpUrl = `${base}/mcp`

  const cfgUrlCli = useMemo(() => `# Claude Code
claude mcp add --transport http motionbase ${mcpUrl} \\
  --header "Authorization: Bearer mb_xxxxxxxx"`, [mcpUrl])

  const cfgUrlJson = useMemo(() => JSON.stringify({
    mcpServers: {
      motionbase: { url: mcpUrl, headers: { Authorization: 'Bearer mb_xxxxxxxx' } },
    },
  }, null, 2), [mcpUrl])

  const cfgBridge = useMemo(() => JSON.stringify({
    mcpServers: {
      motionbase: {
        command: 'npx',
        args: ['-y', 'mcp-remote', mcpUrl, '--allow-http', '--header', 'Authorization: Bearer mb_xxxxxxxx'],
      },
    },
  }, null, 2), [mcpUrl])

  const cfgStdio = useMemo(() => JSON.stringify({
    mcpServers: {
      motionbase: {
        command: 'node',
        args: ['/path/to/motionbase/mcp/index.js'],
        env: { MOTIONBASE_URL: base, MOTIONBASE_TOKEN: 'mb_xxxxxxxx' },
      },
    },
  }, null, 2), [base])

  const cfgDocker = useMemo(() => `# No clone needed: the stdio server is inside the MotionBase Docker image.
# MotionBase's container is named "motionbase" on the same machine:
docker exec -i -e MOTIONBASE_TOKEN=mb_xxxxxxxx motionbase node /app/mcp/index.js

# MotionBase on another machine (VM), over SSH:
ssh user@vm-host docker exec -i -e MOTIONBASE_TOKEN=mb_xxxxxxxx motionbase node /app/mcp/index.js
# (use either as the "command" of a stdio MCP server in your AI tool)`, [])

  const prompt = useMemo(() => `You triage a MotionBase media library through its Agent API.
Base URL: ${api}   Auth: Authorization: Bearer $MOTIONBASE_TOKEN
Full reference: GET /openapi.json.

Setup (once per run):
1. GET /status to see how many files are pending and whether ffmpeg is available.
2. GET /taxonomy. Read every category and tag description: they are the user's rules.
   Prefer existing tags. Only create a new tag when nothing fits, using POST /tags or
   create_missing, and give it a short description. Never invent near-duplicates.
   Categories with selection "single" take at most one tag per file.
   Categories with is_system true are read-only.

Loop until /queue/claim returns no files:
3. POST /queue/claim {"limit": 8, "lease_seconds": 900}.
4. For each file, GET /files/{id}/contact-sheet.jpg?count=9&cols=3 and look at it
   (use /frames/{i}.jpg?count=8 for detail on a specific moment). Use filename, duration,
   and existing tags/notes as extra context. Stills: the single frame is the contact sheet.
5. Decide, per file: category tags via set_category_tags, a one-to-two sentence factual note
   (what it shows, notable motion technique; no speculation), and a folder_path only if
   an existing folder clearly fits. If you are unsure about a file, do NOT mark it
   reviewed; add a short note explaining the doubt and leave it pending.
6. POST /files/bulk with all decisions for the batch, first with "dry_run": true,
   check the results, then repeat without dry_run. Include "mark_reviewed": true only for
   files you are confident about. If you get a 422, fix every listed error and resend.
7. POST /queue/release {} for anything you claimed but skipped.

Rules: never delete or rename anything (the API cannot). Be consistent across files.
If anything looks wrong afterwards, tell the user the activity_id so they can revert it.
When finished, report counts: reviewed, left pending (with reasons), tags created.`, [api])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><RiBookOpenLine className="size-4" /> How to use the Agent API</CardTitle>
        <CardDescription>
          Lets an AI agent (Claude, ChatGPT, Gemini, Cursor, or any script) look at your videos and set categories, tags, notes and folders for you. Full reference: <code>docs/AGENT_API.md</code> in the repo, or <a className="underline" href="/api/agent/v1/openapi.json" target="_blank" rel="noreferrer">openapi.json</a>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={setTab} className="gap-3">
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">What it can do</TabsTrigger>
            <TabsTrigger value="connect">Connect an AI (MCP)</TabsTrigger>
            <TabsTrigger value="start">Quick start (curl)</TabsTrigger>
            <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
            <TabsTrigger value="prompt">Prompt</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="grid gap-4 text-xs">
            <ul className="grid gap-2">
              {CAN.map(([t, d]) => (
                <li key={t}><span className="font-medium">{t}.</span> <span className="text-muted-foreground">{d}</span></li>
              ))}
            </ul>
            <div>
              <p className="mb-1 font-medium">What it cannot do</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{CANNOT.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
            <div className="rounded-lg border p-3 text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">Safety</p>
              Agents authenticate with a token you create here (shown once, stored hashed). Batches are all-or-nothing and can be previewed with <code>dry_run</code>.
              With "Require my confirmation" on, AI-reviewed videos wait in your Inbox until you accept them. The rest of MotionBase has no login, so keep it on a trusted network or behind a reverse proxy.
            </div>
          </TabsContent>

          <TabsContent value="connect" className="grid gap-3">
            <p className="text-xs text-muted-foreground">
              Works with any AI tool or agent that supports MCP (Model Context Protocol): Claude, Cursor, VS Code / Copilot, Windsurf, Gemini CLI, Codex and others. MCP gives the AI native tools (claim videos, look at a contact sheet, apply tags, create folders…) so it can see each video without hand-written HTTP calls. Create a token above and replace <code>mb_xxxxxxxx</code>, then ask the AI to triage your MotionBase inbox. Tools that cannot use MCP can use the HTTP API instead (Quick start tab).
            </p>
            <div className="rounded-lg border p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">Two kinds of MCP server</p>
              <p><span className="font-medium text-foreground">URL (remote, recommended):</span> MotionBase itself serves MCP at <code>{mcpUrl}</code>. Your AI tool connects to that address with your token, from any computer that can reach this server. Nothing to install.</p>
              <p className="mt-1"><span className="font-medium text-foreground">Local (stdio):</span> a small program your AI tool launches on your computer and talks to over standard input/output; it then calls MotionBase over HTTP. Use it for tools that only support local servers, or when you would rather not use a URL.</p>
            </div>

            <p className="text-xs font-medium">Option 1: URL (recommended)</p>
            <p className="text-xs text-muted-foreground">Any client that supports remote ("streamable HTTP") MCP servers with headers, such as Cursor, VS Code, Windsurf and Gemini CLI, takes this config (the file and key names vary slightly by tool):</p>
            <Code label="Copy config">{cfgUrlJson}</Code>
            <Code label="Copy command">{cfgUrlCli}</Code>
            <p className="text-xs text-muted-foreground">Clients that only run local servers (for example Claude Desktop) can reach the URL through the <code>mcp-remote</code> bridge (needs Node):</p>
            <Code label="Copy config">{cfgBridge}</Code>
            <p className="text-xs text-muted-foreground">Web-based AI apps (ChatGPT, claude.ai) need a public HTTPS address. MotionBase has no login of its own, so only expose it that way behind a reverse proxy you trust.</p>

            <p className="text-xs font-medium">Option 2: local program (stdio)</p>
            <Code label="Copy config">{cfgStdio}</Code>
            <p className="text-xs text-muted-foreground">Needs this repo cloned (<code>cd mcp && npm install</code>) and Node 20+. Or run the copy inside the MotionBase container, with no clone:</p>
            <Code label="Copy commands">{cfgDocker}</Code>
            <p className="text-xs text-muted-foreground">Tools: status, taxonomy, list/get files, view contact sheet and frames, claim/release, update files (with dry run), create categories/tags/folders, recent activity. Same safety rules as the API: it cannot delete anything.</p>
          </TabsContent>

          <TabsContent value="start" className="grid gap-3">
            <p className="text-xs text-muted-foreground">Create a token above, then try these (the address below is this server). Everything needs the header <code>Authorization: Bearer mb_…</code>.</p>
            <Code label="Copy commands">{quick}</Code>
          </TabsContent>

          <TabsContent value="endpoints" className="grid gap-2">
            <p className="text-xs text-muted-foreground">All paths are under <code>{api}</code>.</p>
            <ul className="divide-y rounded-lg border text-xs">
              {ENDPOINTS.map(([m, p, d]) => (
                <li key={p + m} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-2">
                  <Badge variant={m === 'GET' ? 'secondary' : 'outline'} className="w-12 justify-center font-mono">{m}</Badge>
                  <code className="font-mono">{p}</code>
                  <span className="text-muted-foreground">{d}</span>
                </li>
              ))}
            </ul>
          </TabsContent>

          <TabsContent value="prompt" className="grid gap-3">
            <p className="text-xs text-muted-foreground">
              Paste this into your AI tool after connecting it (via MCP above, or any agent that can run curl and view images). If you use curl, put the token in an environment variable named <code>MOTIONBASE_TOKEN</code>, never in the prompt. Start with a small batch and check the results before letting it run on everything.
            </p>
            <Code label="Copy prompt">{prompt}</Code>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
