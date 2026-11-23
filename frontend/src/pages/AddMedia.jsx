import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RiUploadCloud2Line, RiCheckLine, RiCloseLine, RiDownloadLine, RiLinkM, RiInboxLine, RiErrorWarningLine,
  RiFilmLine, RiImageLine,
} from '@remixicon/react'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Progress } from '@/components/ui/progress.jsx'
import { Spinner } from '@/components/ui/spinner.jsx'
import { cn } from '@/lib/utils.js'
import { LOGIN_REQUIRED_EVENT, getFiles, parseError, thumbnailUrl } from '@/api/client.js'
import { useFileCounts } from '@/hooks/useInboxCount.js'

let uploadId = 0
const ACCEPT = 'video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,video/x-m4v,image/jpeg,image/png,image/gif,image/webp,image/bmp'

function useRefreshLibrary() {
  const qc = useQueryClient()
  return useCallback(() => {
    qc.invalidateQueries({ queryKey: ['files'] })
    qc.invalidateQueries({ queryKey: ['counts'] })
    qc.invalidateQueries({ queryKey: ['folders'] })
  }, [qc])
}

function FileUpload({ onUploaded }) {
  const [items, setItems] = useState([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const patch = (id, change) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...change } : it)))

  const uploadFile = useCallback((id, file) => {
    patch(id, { status: 'uploading' })
    const form = new FormData()
    form.append('file', file)
    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) patch(id, { progress: Math.round((e.loaded / e.total) * 100) }) }
    xhr.onload = () => {
      if (xhr.status === 200) { patch(id, { status: 'done', progress: 100 }); onUploaded() }
      else if (xhr.status === 401) { window.dispatchEvent(new Event(LOGIN_REQUIRED_EVENT)); patch(id, { status: 'error', message: 'Signed out. Sign in again' }) }
      else patch(id, { status: 'error', message: xhr.status === 400 ? 'Unsupported file type' : `Upload failed (${xhr.status})` })
    }
    xhr.onerror = () => patch(id, { status: 'error', message: 'Network error' })
    xhr.open('POST', '/api/upload')
    xhr.send(form)
  }, [onUploaded])

  const addFiles = useCallback((fileList) => {
    const next = [...fileList].map((file) => ({ id: ++uploadId, file, status: 'pending', progress: 0 }))
    setItems((prev) => [...prev, ...next])
    next.forEach(({ id, file }) => uploadFile(id, file))
  }, [uploadFile])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload files</CardTitle>
        <CardDescription>Videos and images are added to your media folder, then appear in the Inbox.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files) }}
          className={cn(
            'flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-8 text-center outline-none transition-colors',
            'focus-visible:ring-2 focus-visible:ring-ring/40',
            dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/30 hover:bg-muted/40'
          )}
        >
          <RiUploadCloud2Line className="size-7 text-muted-foreground" />
          <span className="text-sm">Drop files here or <span className="font-medium text-primary">browse</span></span>
          <span className="text-xs text-muted-foreground">MP4, MOV, MKV, WebM, AVI · JPG, PNG, GIF, WebP</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose files to upload"
          onChange={(e) => { if (e.target.files.length) addFiles(e.target.files); e.target.value = '' }}
        />

        {items.length > 0 && (
          <ul className="space-y-2" aria-label="Uploads">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Progress value={it.progress} className={cn('gap-1', it.status === 'error' && '[&_[data-slot=progress-indicator]]:bg-destructive')}>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate">{it.file.name}</span>
                      {it.status === 'error' && <span className="flex items-center gap-1 text-destructive"><RiErrorWarningLine className="size-3" />{it.message}</span>}
                      {it.status === 'done' && <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><RiCheckLine className="size-3" />Added</span>}
                      {(it.status === 'uploading' || it.status === 'pending') && <span className="tabular-nums text-muted-foreground">{it.progress}%</span>}
                    </div>
                  </Progress>
                </div>
                {(it.status === 'done' || it.status === 'error') && (
                  <Button size="icon-xs" variant="ghost" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))} aria-label={`Dismiss ${it.file.name}`}>
                    <RiCloseLine />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

const PROGRESS_RE = /^\[download\]\s+[\d.]+%/

function UrlImport({ onImported }) {
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [logs, setLogs] = useState([])
  const [error, setError] = useState(null)
  const logRef = useRef(null)

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [logs])

  const handleImport = async (e) => {
    e?.preventDefault()
    const trimmed = url.trim()
    if (!trimmed || importing) return
    setImporting(true); setError(null); setLogs([])
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })
      if (!res.ok) {
        const err = await parseError(res)
        setError(err.message || 'Import failed')
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          let msg
          try { msg = JSON.parse(line) } catch { continue }
          if (msg.type === 'log') {
            // Progress lines update in place instead of flooding the log.
            setLogs((prev) => (PROGRESS_RE.test(msg.line) && prev.length && PROGRESS_RE.test(prev[prev.length - 1])
              ? [...prev.slice(0, -1), msg.line]
              : [...prev, msg.line]))
          } else if (msg.type === 'done') { setUrl(''); onImported() }
          else if (msg.type === 'error') setError(msg.message)
        }
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import from URL</CardTitle>
        <CardDescription>Download a video from LinkedIn, YouTube and other sites supported by yt-dlp.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleImport} className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-56 flex-1 gap-1.5">
            <Label htmlFor="import-url" className="sr-only">Video URL</Label>
            <div className="relative">
              <RiLinkM className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="import-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                disabled={importing}
                className="h-8 pl-7"
              />
            </div>
          </div>
          <Button type="submit" size="lg" disabled={!url.trim() || importing}>
            {importing ? <Spinner data-icon="inline-start" /> : <RiDownloadLine data-icon="inline-start" />}
            {importing ? 'Downloading…' : 'Import'}
          </Button>
        </form>
        {logs.length > 0 && (
          <div
            ref={logRef}
            role="log"
            aria-label="Import log"
            className="h-36 space-y-0.5 overflow-y-auto rounded-lg bg-zinc-950 p-3 font-mono text-[0.6875rem] leading-relaxed text-zinc-300"
          >
            {logs.map((line, i) => <div key={i} className={PROGRESS_RE.test(line) ? 'text-sky-400' : undefined}>{line}</div>)}
          </div>
        )}
        {error && <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive"><RiErrorWarningLine className="size-3.5" />{error}</p>}
      </CardContent>
    </Card>
  )
}

function RecentlyAdded({ inboxCount }) {
  const { data, isLoading } = useQuery({
    queryKey: ['files', 'recent'],
    queryFn: () => getFiles({ view: 'inbox', sort: 'date_added', order: 'desc', limit: 6 }),
  })
  const files = data?.files ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>Waiting for review</CardTitle>
        <CardDescription>
          {inboxCount > 0 ? `${inboxCount} ${inboxCount === 1 ? 'file is' : 'files are'} in the Inbox.` : 'Nothing is waiting. New uploads will appear here.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? <Spinner /> : files.length > 0 && (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {files.map((f) => {
              const thumb = thumbnailUrl(f)
              return (
                <li key={f.id} className="min-w-0">
                  <div className="aspect-video overflow-hidden rounded-md bg-muted">
                    {thumb ? <img src={thumb} alt="" loading="lazy" className="size-full object-cover" /> : (
                      <span className="flex size-full items-center justify-center text-muted-foreground">
                        {f.file_type === 'video' ? <RiFilmLine /> : <RiImageLine />}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs" title={f.filename}>{f.filename}</p>
                </li>
              )
            })}
          </ul>
        )}
        <Button render={<Link to="/inbox" />} variant={inboxCount > 0 ? 'default' : 'outline'}>
          <RiInboxLine data-icon="inline-start" /> Open Inbox
          {inboxCount > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1">{inboxCount}</Badge>}
        </Button>
      </CardContent>
    </Card>
  )
}

export default function AddMedia() {
  const refresh = useRefreshLibrary()
  const { data: counts } = useFileCounts()
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Add Media</h1>
        <p className="text-xs text-muted-foreground">Upload files or import from a URL, then triage them in the Inbox.</p>
      </div>
      <FileUpload onUploaded={refresh} />
      <UrlImport onImported={refresh} />
      <RecentlyAdded inboxCount={counts?.inbox ?? 0} />
    </div>
  )
}
