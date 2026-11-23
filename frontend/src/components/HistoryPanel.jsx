import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  RiUploadCloud2Line, RiPriceTag3Line, RiStickyNoteLine, RiFolderTransferLine, RiStarLine, RiCheckDoubleLine,
  RiEditLine, RiDeleteBinLine, RiArrowGoBackLine, RiSparklingLine, RiHistoryLine, RiRestartLine, RiEyeOffLine,
} from '@remixicon/react'
import { Badge } from '@/components/ui/badge.jsx'
import { Button } from '@/components/ui/button.jsx'
import { Skeleton } from '@/components/ui/skeleton.jsx'
import { getFileHistory } from '@/api/client.js'
import { absoluteTime, relativeTime } from '@/lib/people.js'

const ICONS = {
  uploaded: RiUploadCloud2Line,
  tags_changed: RiPriceTag3Line,
  notes_changed: RiStickyNoteLine,
  folder_changed: RiFolderTransferLine,
  favorite_changed: RiStarLine,
  reviewed: RiCheckDoubleLine,
  unreviewed: RiEyeOffLine,
  renamed: RiEditLine,
  trashed: RiDeleteBinLine,
  restored: RiRestartLine,
  agent_update: RiSparklingLine,
  reverted: RiArrowGoBackLine,
}

const folderName = (p) => (p ? p.replaceAll('/', ' / ') : 'Unfiled')

function TagChips({ tags, tone }) {
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {tags.map((t, i) => (
        <Badge key={i} variant={tone === 'removed' ? 'outline' : 'secondary'} className={tone === 'removed' ? 'line-through text-muted-foreground' : undefined}>
          {t.category ? `${t.category}: ` : ''}{t.name}
        </Badge>
      ))}
    </span>
  )
}

function NoteBlock({ label, text }) {
  return (
    <div>
      <p className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap break-words rounded-md bg-muted/60 px-2 py-1 text-xs">{text || <span className="text-muted-foreground">(empty)</span>}</p>
    </div>
  )
}

function NotesChange({ detail }) {
  const [open, setOpen] = useState(false)
  const from = detail?.from ?? '', to = detail?.to ?? ''
  const preview = (s) => (s.length > 80 ? `${s.slice(0, 80)}…` : s)
  const long = from.length > 80 || to.length > 80 || from.includes('\n') || to.includes('\n')
  if (!from && !to) return <>Cleared the notes</>
  return (
    <div className="grid gap-1">
      <p>{!from ? 'Added notes' : !to ? 'Cleared the notes' : 'Edited the notes'}</p>
      {open ? (
        <div className="grid gap-1.5">
          {from && <NoteBlock label="From" text={from} />}
          {to && <NoteBlock label="To" text={to} />}
        </div>
      ) : (
        <p className="truncate text-muted-foreground">{to ? `"${preview(to.split('\n')[0])}"` : ''}</p>
      )}
      {(long || (from && to)) && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="w-fit text-xs text-primary underline-offset-2 hover:underline">
          {open ? 'Hide details' : 'Show from / to'}
        </button>
      )}
    </div>
  )
}

function summarize(e, uploaded) {
  const d = e.detail || {}
  switch (e.action) {
    case 'uploaded': {
      const src = d.source ?? uploaded?.source
      const who = e.actor?.label
      if (src === 'scan') return <>Found by the library scan{d.filename ? <> as <span className="font-mono">{d.filename}</span></> : null}</>
      if (src === 'import') return <>Imported from a URL{who ? <> by <b>{who}</b></> : null}</>
      if (src === 'user') return <>Uploaded{who ? <> by <b>{who}</b></> : null}</>
      return <>Added to the library. Uploader unknown (before accounts).</>
    }
    case 'tags_changed':
      return (
        <div className="grid gap-1">
          {d.added?.length > 0 && <p><span className="mr-1 text-muted-foreground">Added</span><TagChips tags={d.added} /></p>}
          {d.removed?.length > 0 && <p><span className="mr-1 text-muted-foreground">Removed</span><TagChips tags={d.removed} tone="removed" /></p>}
        </div>
      )
    case 'notes_changed': return <NotesChange detail={d} />
    case 'folder_changed': return <>Moved from <b>{folderName(d.from_path)}</b> to <b>{folderName(d.to_path)}</b></>
    case 'favorite_changed': return d.to ? <>Added to favorites</> : <>Removed from favorites</>
    case 'reviewed': return <>Marked as reviewed</>
    case 'unreviewed': return <>Marked as not reviewed</>
    case 'renamed': return <>Renamed from <span className="font-mono">{d.from}</span> to <span className="font-mono">{d.to}</span></>
    case 'trashed': return <>Moved to Trash</>
    case 'restored': return <>Restored from Trash</>
    case 'agent_update': return <>Reviewed by the agent{d.awaiting_confirmation ? ', waiting for your confirmation' : ''}</>
    case 'reverted': return <>Agent change reverted{d.agent ? <> (from <b>{d.agent}</b>)</> : null}</>
    default: return <>{e.action.replaceAll('_', ' ')}</>
  }
}

function Actor({ e }) {
  const label = e.actor?.label
  if (!label) return <span className="text-muted-foreground">Someone (no account)</span>
  const agent = /\s\(agent\)$/.test(label)
  return (
    <span className="inline-flex items-center gap-1 font-medium">
      {agent ? label.replace(/\s\(agent\)$/, '') : label}
      {agent && <Badge variant="secondary" className="text-primary"><RiSparklingLine /> AI</Badge>}
    </span>
  )
}

export default function HistoryPanel({ fileId }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['file', String(fileId), 'history'],
    queryFn: () => getFileHistory(fileId),
    staleTime: 0,
  })

  if (isLoading) return <div className="grid gap-3 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
  if (isError) {
    return (
      <div className="grid gap-2 p-3 text-xs">
        <p role="alert" className="text-destructive">Could not load history: {error.message}</p>
        <div><Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button></div>
      </div>
    )
  }

  const events = [...(data?.events ?? [])]
  // Make sure the upload entry is always last, even if the event list was cut short.
  if (!events.some((e) => e.action === 'uploaded') && data?.uploaded) {
    events.push({
      id: 'upload', action: 'uploaded', synthetic: true,
      actor: { user_id: data.uploaded.by?.id ?? null, label: data.uploaded.by?.display_name ?? null },
      detail: { source: data.uploaded.source }, created_at: data.uploaded.at,
    })
  }

  return (
    <ol className="relative grid gap-0 p-3" aria-label="File history, newest first">
      {events.map((e, i) => {
        const Icon = ICONS[e.action] ?? RiHistoryLine
        const last = i === events.length - 1
        const isUpload = e.action === 'uploaded'
        return (
          <li key={e.id ?? `s${i}`} className="relative flex gap-3 pb-4" data-action={e.action}>
            {!last && <span aria-hidden className="absolute bottom-0 left-[0.8125rem] top-7 w-px bg-border" />}
            <span aria-hidden className="z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-4 ring-background">
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 text-xs/relaxed">
              {!isUpload && <p className="flex flex-wrap items-center gap-x-1.5"><Actor e={e} /></p>}
              <div className="text-foreground/90">{summarize(e, data?.uploaded)}</div>
              <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                <time dateTime={e.created_at} title={absoluteTime(e.created_at)}>{relativeTime(e.created_at)}</time>
                {' · '}{absoluteTime(e.created_at)}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
