import React, { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  RiDownloadLine, RiFileCopyLine, RiCloseCircleLine, RiDeleteBinLine, RiHardDriveLine, RiUploadLine,
  RiCheckLine, RiErrorWarningLine, RiFileTextLine, RiFileZipLine, RiFolderLine,
} from '@remixicon/react'
import {
  getExportEstimate, getExportJobs, getExportJob, createExportJob, cancelExportJob, deleteExportJob, importMetadata,
} from '@/api/client.js'
import { Button } from '@/components/ui/button.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Switch } from '@/components/ui/switch.jsx'
import { Progress } from '@/components/ui/progress.jsx'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { useAuth } from '@/context/AuthContext.jsx'

export function fmtBytes(n) {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  do { n /= 1024; i++ } while (n >= 1024 && i < u.length - 1)
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`
}

const ACTIVE = new Set(['queued', 'running'])
const STATE_STYLE = {
  queued: 'secondary', running: 'default', done: 'secondary', failed: 'destructive', cancelled: 'outline',
}

function SwitchRow({ id, label, hint, checked, onChange }) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}

function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) return navigator.clipboard.writeText(text)
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')) } catch (e) { reject(e) } finally { ta.remove() }
  })
}

function jobTitle(j) {
  return `${j.mode === 'metadata' ? 'Metadata' : 'Full export'}, ${j.layout === 'folder' ? 'folder' : 'zip'}`
}

function JobPanel({ jobId, onGone }) {
  const qc = useQueryClient()
  const { data: job, error } = useQuery({
    queryKey: ['export-job', jobId],
    queryFn: () => getExportJob(jobId),
    refetchInterval: (q) => (!q.state.data || ACTIVE.has(q.state.data.state) ? 1000 : false),
  })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['export-jobs'] }); qc.invalidateQueries({ queryKey: ['export-job', jobId] }) }
  useEffect(() => { if (job && !ACTIVE.has(job.state)) qc.invalidateQueries({ queryKey: ['export-jobs'] }) }, [job?.state]) // eslint-disable-line
  const cancel = useMutation({ mutationFn: () => cancelExportJob(jobId), onSuccess: refresh, onError: (e) => toast.error(e.message) })
  const remove = useMutation({
    mutationFn: () => deleteExportJob(jobId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['export-jobs'] }); onGone(); toast.success('Export deleted') },
    onError: (e) => toast.error(e.message),
  })
  if (error) return <p role="alert" className="text-sm text-destructive">{error.message}</p>
  if (!job) return null
  const pct = job.files_total ? Math.min(100, Math.round((job.files_done / job.files_total) * 100)) : job.state === 'done' ? 100 : 0
  const active = ACTIVE.has(job.state)
  return (
    <div className="grid gap-3 rounded-lg border p-3" data-testid="job-panel" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATE_STYLE[job.state]} data-testid="job-state">{job.state}</Badge>
        <span className="text-sm font-medium">{jobTitle(job)}</span>
        <div className="ml-auto flex gap-2">
          {active && <Button size="sm" variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}><RiCloseCircleLine /> Cancel</Button>}
          {job.state === 'done' && job.download_url && (
            <Button size="sm" render={<a href={job.download_url} download />}><RiDownloadLine /> Download zip</Button>
          )}
          {!active && <Button size="sm" variant="outline" onClick={() => remove.mutate()} disabled={remove.isPending}><RiDeleteBinLine /> Delete output</Button>}
        </div>
      </div>
      {job.mode === 'full' && (
        <>
          <Progress value={pct} aria-label="Export progress" />
          <p className="text-xs text-muted-foreground" data-testid="job-progress">
            {job.files_done} / {job.files_total} files · {fmtBytes(job.bytes_done)} of {fmtBytes(job.bytes_total)}
            {job.files_skipped > 0 && <> · <span className="text-amber-600 dark:text-amber-400">{job.files_skipped} skipped</span></>}
          </p>
        </>
      )}
      {job.state === 'failed' && job.error && <p role="alert" className="text-sm text-destructive">{job.error}</p>}
      {job.skipped?.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Skipped files</summary>
          <ul className="mt-1 list-disc pl-5">{job.skipped.slice(0, 10).map((s, i) => <li key={i} className="break-all">{typeof s === 'string' ? s : (s.path || s.name || JSON.stringify(s))}</li>)}</ul>
        </details>
      )}
      {job.path && (
        <div className="flex items-center gap-2 text-xs">
          <span className="shrink-0 text-muted-foreground">On the server:</span>
          <code className="min-w-0 flex-1 break-all rounded bg-muted px-1.5 py-1">{job.path}</code>
          <Button size="icon-sm" variant="ghost" aria-label="Copy server path"
            onClick={() => copyText(job.path).then(() => toast.success('Path copied'), () => toast.error('Could not copy'))}><RiFileCopyLine /></Button>
        </div>
      )}
    </div>
  )
}

function RecentJobs({ activeId, onSelect }) {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['export-jobs'],
    queryFn: getExportJobs,
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => ACTIVE.has(j.state)) ? 2000 : false),
  })
  const remove = useMutation({
    mutationFn: deleteExportJob,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['export-jobs'] }); toast.success('Export deleted') },
    onError: (e) => toast.error(e.message),
  })
  const jobs = data?.jobs ?? []
  if (!jobs.length) return null
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">Recent exports on the server</h3>
      <ul className="grid gap-1.5" data-testid="recent-jobs">
        {jobs.map((j) => (
          <li key={j.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
            <Badge variant={STATE_STYLE[j.state]}>{j.state}</Badge>
            <button type="button" className="text-left hover:underline" onClick={() => onSelect(j.id)}>{jobTitle(j)}</button>
            <span className="text-xs text-muted-foreground">{new Date(j.created_at).toLocaleString()}{j.output_bytes ? ` · ${fmtBytes(j.output_bytes)}` : ''}</span>
            <div className="ml-auto flex gap-1">
              {j.state === 'done' && j.download_url && <Button size="icon-sm" variant="ghost" aria-label="Download" render={<a href={j.download_url} download />}><RiDownloadLine /></Button>}
              {!ACTIVE.has(j.state) && <Button size="icon-sm" variant="ghost" aria-label="Delete export" disabled={remove.isPending} onClick={() => remove.mutate(j.id)}><RiDeleteBinLine /></Button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ExportCard() {
  const qc = useQueryClient()
  const [mode, setMode] = useState('metadata')
  const [history, setHistory] = useState(false)
  const [trash, setTrash] = useState(false)
  const [jobId, setJobId] = useState(null)
  const [space, setSpace] = useState(null)
  const { data: est } = useQuery({ queryKey: ['export-estimate', trash], queryFn: () => getExportEstimate(trash), enabled: mode === 'full' })
  const qs = `include_history=${history ? 1 : 0}&include_trash=${trash ? 1 : 0}`

  const start = useMutation({
    mutationFn: (layout) => createExportJob({ mode: 'full', layout, include_history: history, include_trash: trash }),
    onMutate: () => setSpace(null),
    onSuccess: (job) => { setJobId(job.id); qc.invalidateQueries({ queryKey: ['export-jobs'] }) },
    onError: (e) => {
      if (e.status === 507) setSpace(e.body || {})
      else toast.error(e.message)
    },
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Export</CardTitle>
        <CardDescription>Take your library with you: your videos in their folders plus tags, notes, favorites and review state.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <ToggleGroup variant="outline" value={[mode]} aria-label="Export type" onValueChange={(v) => { if (v[0]) setMode(v[0]) }}
          className="flex-wrap">
          <ToggleGroupItem value="metadata"><RiFileTextLine /> Metadata only</ToggleGroupItem>
          <ToggleGroupItem value="full"><RiFileZipLine /> Full export (videos + metadata)</ToggleGroupItem>
        </ToggleGroup>

        <div className="grid gap-3">
          <SwitchRow id="exp-history" label="Include history" checked={history} onChange={setHistory}
            hint="Who changed what and when. Only appears in metadata.json, never in the CSV." />
          <SwitchRow id="exp-trash" label="Include trash" checked={trash} onChange={setTrash}
            hint="Off by default: files in the Trash are left out." />
        </div>

        {mode === 'metadata' ? (
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              <Button render={<a href={`/api/export/metadata?format=csv&${qs}`} download />}><RiDownloadLine /> Download CSV</Button>
              <Button variant="outline" render={<a href={`/api/export/metadata?format=json&${qs}`} download />}><RiDownloadLine /> Download JSON</Button>
            </div>
            <p className="text-xs text-muted-foreground">CSV opens in a spreadsheet. JSON (metadata.json) is what Restore reads.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground" data-testid="estimate">
              {est ? <>This export has <strong className="text-foreground">{est.files.toLocaleString()} files</strong>, about <strong className="text-foreground">{fmtBytes(est.bytes)}</strong>.</> : 'Counting files…'}
            </p>
            <div className="grid gap-2 rounded-lg border p-3">
              <h3 className="text-sm font-medium">Download zip now</h3>
              <p className="text-xs text-muted-foreground">
                The zip is built while it downloads, so your browser shows progress but no total, and nothing is stored on the server. Large libraries take a while; keep the tab open.
                For big libraries, save on the server instead.
              </p>
              <div><Button render={<a href={`/api/export/download.zip?${qs}`} download />}><RiDownloadLine /> Download zip now</Button></div>
            </div>
            <div className="grid gap-2 rounded-lg border p-3">
              <h3 className="text-sm font-medium">Save on the server</h3>
              <p className="text-xs text-muted-foreground">
                Writes the export into the server's export folder (<code>EXPORT_DIR</code>, by default <code>data/exports</code>) so you can close this page and fetch it later or copy it yourself.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={start.isPending} onClick={() => start.mutate('zip')}><RiHardDriveLine /> Save as zip</Button>
                <Button variant="outline" disabled={start.isPending} onClick={() => start.mutate('folder')}><RiFolderLine /> Save as folder</Button>
              </div>
              {space && (
                <div role="alert" className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive" data-testid="space-error">
                  <RiErrorWarningLine className="mt-0.5 shrink-0" />
                  <div>
                    Not enough free space on the server for this export.
                    {space?.needed_bytes != null && <> It needs {fmtBytes(space.needed_bytes)} but only {fmtBytes(space.free_bytes)} is free.</>}
                    <span className="block text-xs">Free up space or point EXPORT_DIR at a bigger volume.</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {jobId && <JobPanel key={jobId} jobId={jobId} onGone={() => setJobId(null)} />}
        <RecentJobs activeId={jobId} onSelect={setJobId} />
        <p className="text-xs text-muted-foreground">
          Exports are not stored with your library: server-side exports go to <code>EXPORT_DIR</code> (outside the media folder). Database, tokens, passwords and cookies are never exported.
          The Trash is excluded unless you switch it on above.
        </p>
      </CardContent>
    </Card>
  )
}

const Stat = ({ label, value, testid }) => (
  <div className="rounded-md border px-2.5 py-1.5"><div className="text-lg font-semibold tabular-nums" data-testid={testid}>{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>
)

function RestoreCard() {
  const [text, setText] = useState(null)
  const [name, setName] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [dry, setDry] = useState(null)
  const [final, setFinal] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [over, setOver] = useState(false)
  const input = useRef(null)

  async function pick(file) {
    if (!file) return
    setDry(null); setFinal(null); setConfirming(false)
    const t = await file.text()
    try {
      const j = JSON.parse(t)
      if (!j || !Array.isArray(j.files)) throw new Error('no files list')
    } catch {
      setText(null); setName('')
      toast.error('That does not look like a MotionBase metadata.json')
      return
    }
    setText(t); setName(file.name)
  }
  const run = useMutation({
    mutationFn: (dryRun) => importMetadata(text, { dryRun, overwriteNotes: overwrite }),
    onSuccess: (r, dryRun) => { if (dryRun) { setDry(r); setFinal(null) } else { setFinal(r); setDry(null); setConfirming(false); toast.success('Metadata restored') } },
    onError: (e) => toast.error(e.message),
  })
  const changeOverwrite = (v) => { setOverwrite(v); setDry(null); setConfirming(false) }
  const res = final || dry
  return (
    <Card>
      <CardHeader>
        <CardTitle>Restore metadata</CardTitle>
        <CardDescription>Put tags, folders, notes, favorites and review state back from an exported metadata.json.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ol className="list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
          <li>Copy your videos back into the media folder, keeping the folder layout.</li>
          <li>Scan the library (Settings &gt; General) so MotionBase knows the files.</li>
          <li>Choose metadata.json below, check the dry run, then apply.</li>
        </ol>
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]) }}
          className={`flex flex-col items-center gap-2 rounded-lg border border-dashed p-5 text-center ${over ? 'border-primary bg-accent' : ''}`}>
          <RiUploadLine className="size-5 text-muted-foreground" />
          <p className="text-sm">{name ? <>Selected <strong>{name}</strong></> : 'Drop metadata.json here'}</p>
          <Button variant="outline" size="sm" onClick={() => input.current?.click()}>Choose file</Button>
          <input ref={input} type="file" accept=".json,application/json" hidden data-testid="restore-file" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        <SwitchRow id="rs-overwrite" label="Overwrite existing notes" checked={overwrite} onChange={changeOverwrite}
          hint="Off: notes are only filled in when the file's notes are empty." />
        <div className="flex flex-wrap gap-2">
          <Button disabled={!text || run.isPending} onClick={() => run.mutate(true)}>{run.isPending && run.variables === true ? 'Checking…' : 'Dry run (changes nothing)'}</Button>
        </div>

        {res && (
          <div className="grid gap-3" data-testid="restore-result">
            <div className="flex items-center gap-2 text-sm font-medium">
              {final ? <><RiCheckLine className="text-emerald-600" /> Restore finished</> : 'Dry run result (nothing was changed)'}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="files matched" value={`${res.matched} / ${res.total}`} testid="r-matched" />
              <Stat label="not found" value={res.unmatched_count} testid="r-unmatched" />
              <Stat label="tags to add" value={res.tags_added} testid="r-tags" />
              <Stat label="folders to create" value={res.folders_created} testid="r-folders" />
              <Stat label="notes to set" value={res.notes_set} testid="r-notes" />
              <Stat label="files changed" value={res.files_changed} testid="r-changed" />
            </div>
            {(res.categories_created > 0 || res.tags_created > 0 || res.folders_set > 0 || res.favorites_set > 0 || res.reviewed_set > 0 || res.notes_skipped > 0) && (
              <p className="text-xs text-muted-foreground">
                Also: {res.categories_created} new categories, {res.tags_created} new tags, {res.folders_set} files filed into folders,
                {' '}{res.favorites_set} favorites, {res.reviewed_set} reviewed{res.notes_skipped > 0 && <>, {res.notes_skipped} notes kept (already had notes)</>}.
              </p>
            )}
            {res.unmatched_count > 0 && (
              <div className="text-xs">
                <p className="text-muted-foreground">Not found in the library (copy these videos back and scan, then run again):</p>
                <ul className="mt-1 list-disc pl-5 break-all">
                  {res.unmatched.slice(0, 5).map((u, i) => <li key={i}>{typeof u === 'string' ? u : (u.relative_path || u.filename)}</li>)}
                  {res.unmatched_count > 5 && <li className="list-none text-muted-foreground">and {res.unmatched_count - 5} more</li>}
                </ul>
              </div>
            )}
            {res.errors?.length > 0 && <p role="alert" className="text-xs text-destructive">{res.errors.join('; ')}</p>}
            {dry && (confirming ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-2.5 text-sm">
                <span>Apply these changes to your library? It cannot be undone, but running it twice changes nothing more.</span>
                <Button size="sm" disabled={run.isPending} onClick={() => run.mutate(false)}>{run.isPending ? 'Applying…' : 'Yes, apply restore'}</Button>
                <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            ) : (
              <div><Button onClick={() => setConfirming(true)} disabled={res.matched === 0}>Apply restore</Button></div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function DataTab() {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <p className="p-4 text-sm text-muted-foreground">Only administrators can export or restore data.</p>
  return (
    <div className="grid gap-4">
      <ExportCard />
      <RestoreCard />
    </div>
  )
}
