import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RiArrowLeftLine, RiArrowRightLine, RiCheckLine, RiCloseLine, RiDownloadLine, RiImageLine, RiPencilLine,
  RiStarFill, RiStarLine, RiCheckDoubleLine, RiFolderLine, RiFolderOpenLine, RiDeleteBinLine, RiSparklingLine,
  RiStackLine, RiLayoutGridLine, RiArrowLeftSLine, RiArrowRightSLine,
} from '@remixicon/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.jsx'
import { Kbd } from '@/components/ui/kbd.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Skeleton } from '@/components/ui/skeleton.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { ScrollArea } from '@/components/ui/scroll-area.jsx'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable.jsx'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty.jsx'
import { useDefaultLayout } from 'react-resizable-panels'
import VideoPlayer from '@/components/VideoPlayer.jsx'
import TagEditor from '@/components/TagEditor.jsx'
import NotesEditor, { SaveIndicator } from '@/components/NotesEditor.jsx'
import HistoryPanel from '@/components/HistoryPanel.jsx'
import MoveToFolderDialog from '@/components/MoveToFolderDialog.jsx'
import { getFile, getGroup, getNextFile, patchFile, removeFromGroup, ungroupGroup, updateGroup, createGroup, addToGroup, streamUrl, thumbnailUrl, downloadUrl } from '@/api/client.js'
import { useFolders } from '@/hooks/useFolders.js'
import { useBulkActions } from '@/hooks/useBulkActions.js'
import { useIsMobile } from '@/hooks/use-mobile.js'
import { folderPath } from '@/lib/folders.js'
import { useAuth } from '@/context/AuthContext.jsx'
import { sourceLabel } from '@/lib/people.js'
import { cn } from '@/lib/utils.js'

function formatBytes(bytes) {
  if (!bytes) return null
  const units = ['B', 'KB', 'MB', 'GB']
  let val = bytes
  let i = 0
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
  return `${val.toFixed(i === 0 || val >= 10 ? 0 : 1)} ${units[i]}`
}

function InfoList({ file, folderLabel, onMove, groupSection }) {
  const { enabled } = useAuth()
  const rows = [
    ['Type', file.file_type],
    ['Dimensions', file.width ? `${file.width}×${file.height}` : '—'],
    ['Duration', file.duration ? `${file.duration.toFixed(2)}s` : '—'],
    ['Size', formatBytes(file.file_size) ?? '—'],
    ['Frame rate', file.fps ? `${Math.round(file.fps * 100) / 100} fps` : '—'],
    ['Aspect ratio', file.aspect_ratio ?? '—'],
    ['Added', file.date_added ? new Date(file.date_added.replace(' ', 'T') + 'Z').toLocaleDateString() : '—'],
  ]
  const uploadedBy = file.uploader
    ? file.uploader.display_name
    : file.upload_source ? sourceLabel(file.upload_source) : 'Unknown (before accounts)'
  if (enabled || file.uploader || file.upload_source) rows.push(['Uploaded by', uploadedBy])
  const reviewed = file.reviewed_at
    ? `Reviewed${file.reviewed_by && file.reviewed_by !== 'user' ? ` (${file.reviewed_by})` : ''}`
    : file.agent_reviewed_at ? 'Reviewed by AI, awaiting your confirmation' : 'Not reviewed yet'
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className={k === 'Uploaded by' ? undefined : 'font-mono'}>{v}</dd>
        </React.Fragment>
      ))}
      <dt className="text-muted-foreground">Folder</dt>
      <dd className="flex items-center gap-1.5">
        <RiFolderLine className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 truncate">{folderLabel}</span>
        <Button variant="ghost" size="xs" onClick={onMove}>Change</Button>
      </dd>
      <dt className="text-muted-foreground">Review</dt>
      <dd>{reviewed}</dd>
      {groupSection}
    </dl>
  )
}

// Undo of "Remove from group": put the clip back at its old position. When the group dissolved
// (it needs two clips) it is created again in the same order.
async function restoreMembership(gid, order, title) {
  let exists = true
  try { await getGroup(gid) } catch { exists = false }
  if (!exists) { await createGroup(order, title); return }
  await addToGroup(gid, order)
  await updateGroup(gid, { order })
}

const clipsOf = (g) => (g?.members ?? []).filter((m) => !m.deleted_at)

/** Thumbnail strip to move between the clips of a media group without leaving the Library context. */
function GroupStrip({ group, currentId, onOpen }) {
  const items = clipsOf(group)
  const idx = items.findIndex((m) => String(m.id) === String(currentId))
  const go = (d) => { if (items.length > 1 && idx !== -1) onOpen(items[(idx + d + items.length) % items.length].id) }
  const stripRef = useRef(null)
  useEffect(() => {
    stripRef.current?.querySelector('[aria-current=true]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [currentId, items.length])
  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable=true], [role=dialog]')) return
      e.preventDefault()
      go(e.key === 'ArrowLeft' ? -1 : 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
  if (items.length < 2 || idx === -1) return null
  return (
    <nav aria-label={`Clips in ${group.title}`} className="shrink-0 rounded-xl bg-card p-2 ring-1 ring-foreground/10" data-testid="group-strip">
      <div className="mb-1.5 flex items-center gap-2 text-xs">
        <RiStackLine className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium" title={group.title}>{group.title}</span>
        <span className="tabular-nums text-muted-foreground" aria-live="polite">Item {idx + 1} of {items.length}</span>
        <Button variant="outline" size="icon-sm" onClick={() => go(-1)} aria-label="Previous item in group" title="Previous item (Alt+←)"><RiArrowLeftSLine /></Button>
        <Button variant="outline" size="icon-sm" onClick={() => go(1)} aria-label="Next item in group" title="Next item (Alt+→)"><RiArrowRightSLine /></Button>
      </div>
      <ul ref={stripRef} className="flex gap-1.5 overflow-x-auto pb-0.5">
        {items.map((m, i) => (
          <li key={m.id} className="shrink-0">
            <button
              type="button"
              onClick={() => onOpen(m.id)}
              aria-label={`Item ${i + 1} of ${items.length}: ${m.filename}`}
              aria-current={i === idx ? 'true' : undefined}
              title={m.filename}
              className={cn(
                'relative block h-12 w-20 overflow-hidden rounded-md bg-muted outline-none ring-1 ring-foreground/10 focus-visible:ring-2 focus-visible:ring-ring',
                i === idx ? 'ring-2 ring-primary' : 'opacity-70 hover:opacity-100'
              )}
            >
              {thumbnailUrl(m) ? <img src={thumbnailUrl(m)} alt="" loading="lazy" draggable={false} className="size-full object-cover" /> : null}
              <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 font-mono text-[0.625rem] text-white">{i + 1}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Info tab rows for a clip that belongs to a group: inline rename, remove from group, ungroup. */
function GroupInfo({ file, group, onRename, onRemove, onUngroup }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(null)
  const title = group?.title ?? file.group_title
  const save = async () => {
    const t = draft.trim()
    if (!t || t === title) { setEditing(false); return }
    try { await onRename(t); setEditing(false); setError(null) } catch (err) { setError(err.message) }
  }
  return (
    <>
      <dt className="text-muted-foreground">Group</dt>
      <dd className="grid gap-1.5">
        {editing ? (
          <span className="flex items-center gap-1">
            <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Group name" className="h-7"
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }} />
            <Button size="icon-sm" variant="ghost" onClick={save} aria-label="Save group name"><RiCheckLine /></Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setEditing(false)} aria-label="Cancel rename"><RiCloseLine /></Button>
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <RiStackLine className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate" title={title} data-testid="group-title">{title}</span>
            <Button size="icon-sm" variant="ghost" onClick={() => { setDraft(title); setEditing(true) }} aria-label="Rename group"><RiPencilLine /></Button>
          </span>
        )}
        {error && <span role="alert" className="text-destructive">{error}</span>}
        <span className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" onClick={onRemove}>Remove from group</Button>
          <Button size="xs" variant="outline" onClick={onUngroup}><RiLayoutGridLine data-icon="inline-start" /> Ungroup</Button>
        </span>
      </dd>
    </>
  )
}

export default function Player() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()
  const isMobile = useIsMobile()
  const bulk = useBulkActions()
  const { data: folderData } = useFolders()
  const [saveState, setSaveState] = useState('idle')
  const [tab, setTab] = useState('tags')
  const [moving, setMoving] = useState(false)
  const [nextLoading, setNextLoading] = useState(false)

  const { data: file, isLoading, isError } = useQuery({ queryKey: ['file', id], queryFn: () => getFile(id) })
  const { data: group } = useQuery({
    queryKey: ['group', file?.group_id],
    queryFn: () => getGroup(file.group_id),
    enabled: !!file?.group_id,
  })
  const layout = useDefaultLayout({ id: 'player-layout', storage: window.localStorage })

  const applyUpdate = useCallback((updated) => {
    qc.setQueryData(['file', String(updated.id)], updated)
    qc.invalidateQueries({ queryKey: ['files'] })
    qc.invalidateQueries({ queryKey: ['counts'] })
    qc.invalidateQueries({ queryKey: ['file', String(updated.id), 'history'] })
  }, [qc])

  const openItem = useCallback((fid) => navigate(`/player/${fid}?${searchParams.toString()}`, { replace: true }), [navigate, searchParams])
  const groupActions = {
    rename: async (to) => {
      const from = group?.title ?? file.group_title
      await bulk.renameGroup(file.group_id, from, to)
    },
    remove: () => {
      const gid = file.group_id, fid = file.id
      const order = clipsOf(group).map((m) => m.id)
      const title = group?.title
      return bulk.run(
        'Removed from the group',
        () => removeFromGroup(gid, [fid]),
        () => restoreMembership(gid, order, title),
      )
    },
    ungroup: () => {
      const order = clipsOf(group).map((m) => m.id)
      const title = group?.title
      return bulk.run(
        `Ungrouped ${order.length} clips`,
        () => ungroupGroup(file.group_id),
        () => createGroup(order, title),
      )
    },
  }

  useEffect(() => { setTab('tags') }, [id])
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'M' || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable=true], [role=dialog]')) return
      e.preventDefault(); setMoving(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const goNext = useCallback(async () => {
    setNextLoading(true)
    try {
      const { nextId } = await getNextFile(id, { ...Object.fromEntries(searchParams), collapse: '1' })
      navigate(`/player/${nextId}?${searchParams.toString()}`)
    } catch {
      toast.info('No other files in this view')
    } finally { setNextLoading(false) }
  }, [id, searchParams, navigate])

  // Move to Trash (soft delete, with Undo toast), then continue to the next file in this view.
  const deleteCurrent = useCallback(async () => {
    if (!file) return
    let nextId = null
    try { nextId = (await getNextFile(id, { ...Object.fromEntries(searchParams), collapse: '1' })).nextId } catch {}
    const ok = await bulk.deleteFiles([file])
    if (!ok) return
    if (nextId && String(nextId) !== String(id)) navigate(`/player/${nextId}?${searchParams.toString()}`, { replace: true })
    else navigate(`/library?${searchParams.toString()}`, { replace: true })
  }, [file, id, searchParams, navigate, bulk])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Delete' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable=true], [role=dialog]')) return
      e.preventDefault(); deleteCurrent()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [deleteCurrent])

  // ----- Filename editing
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState(null)
  const ext = file?.filename.includes('.') ? file.filename.slice(file.filename.lastIndexOf('.')) : ''
  const baseName = file ? (ext ? file.filename.slice(0, -ext.length) : file.filename) : ''

  const startEditName = () => { setDraftName(baseName); setNameError(null); setEditingName(true) }
  const cancelEditName = () => { setEditingName(false); setNameError(null) }
  const saveEditName = async () => {
    const trimmed = draftName.trim()
    if (!trimmed || trimmed === baseName) { cancelEditName(); return }
    setNameSaving(true); setNameError(null)
    try {
      applyUpdate(await patchFile(file.id, { filename: trimmed + ext }))
      setEditingName(false)
    } catch (err) { setNameError(err.message) } finally { setNameSaving(false) }
  }

  const toggleFavorite = async () => {
    try { applyUpdate(await patchFile(file.id, { is_favorite: file.is_favorite ? 0 : 1 })) } catch (err) { toast.error(err.message) }
  }

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="aspect-video w-full max-w-3xl" />
      </div>
    )
  }

  if (isError || !file) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon"><RiImageLine /></EmptyMedia>
          <EmptyTitle>File not found</EmptyTitle>
          <EmptyDescription>It may have been deleted or moved.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent><Button onClick={() => navigate('/library')}>Back to library</Button></EmptyContent>
      </Empty>
    )
  }

  const folders = folderData?.folders ?? []
  const folderLabel = file.folder_id == null ? 'Unfiled' : folderPath(folders, file.folder_id).join(' / ') || 'Unfiled'
  const aiTagged = file.tags?.some((t) => t.source === 'agent')

  const header = (
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
      <Button variant="ghost" onClick={() => navigate(`/library?${searchParams.toString()}`)} aria-label="Back to library">
        <RiArrowLeftLine data-icon="inline-start" /> Back
      </Button>

      <div className="min-w-0 flex-1">
        {editingName ? (
          <div className="flex max-w-lg items-center gap-1.5">
            <Input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEditName(); if (e.key === 'Escape') cancelEditName() }}
              disabled={nameSaving}
              aria-label="File name"
              aria-invalid={!!nameError}
              className="h-7 flex-1"
            />
            {ext && <span className="text-xs text-muted-foreground">{ext}</span>}
            <Button size="icon-sm" variant="ghost" onClick={saveEditName} disabled={nameSaving} aria-label="Save name"><RiCheckLine /></Button>
            <Button size="icon-sm" variant="ghost" onClick={cancelEditName} aria-label="Cancel rename"><RiCloseLine /></Button>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-1">
            <h1 className="truncate text-sm font-medium" title={file.filename}>{file.filename}</h1>
            <Button size="icon-sm" variant="ghost" onClick={startEditName} aria-label="Rename file"><RiPencilLine /></Button>
            {aiTagged && <Badge variant="secondary" className="text-primary"><RiSparklingLine /> AI</Badge>}
          </div>
        )}
        {nameError && <p role="alert" className="text-xs text-destructive">{nameError}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="outline" onClick={toggleFavorite} aria-pressed={!!file.is_favorite}>
          {file.is_favorite ? <RiStarFill data-icon="inline-start" className="text-amber-500" /> : <RiStarLine data-icon="inline-start" />}
          <span className="max-sm:sr-only">{file.is_favorite ? 'Favorited' : 'Favorite'}</span>
        </Button>
        {!file.reviewed_at && (
          <Button variant="outline" onClick={() => bulk.markReviewed([file])}>
            <RiCheckDoubleLine data-icon="inline-start" /> <span className="max-sm:sr-only">Mark reviewed</span>
          </Button>
        )}
        <Button variant="outline" render={<a href={downloadUrl(file.id)} download={file.filename} />}>
          <RiDownloadLine data-icon="inline-start" /> <span className="max-sm:sr-only">Download</span>
        </Button>
        <Button variant="outline" onClick={deleteCurrent} aria-label="Move to Trash">
          <RiDeleteBinLine data-icon="inline-start" /> <span className="max-sm:sr-only">Delete</span>
        </Button>
        <Button onClick={goNext} disabled={nextLoading}>
          Next <RiArrowRightLine data-icon="inline-end" />
        </Button>
      </div>
    </header>
  )

  const media = file.file_type === 'video' ? (
    <VideoPlayer file={file} />
  ) : (
    <div className="flex size-full items-center justify-center overflow-hidden rounded-xl bg-muted">
      {thumbnailUrl(file) ? (
        <img src={streamUrl(file.id)} alt={file.filename} className="max-h-full max-w-full object-contain" />
      ) : (
        <div className="flex flex-col items-center gap-2 text-muted-foreground"><RiImageLine className="size-8" /><span className="text-xs">No preview</span></div>
      )}
    </div>
  )

  const mediaWithStrip = file.group_id != null && clipsOf(group).length > 1 ? (
    <div className="flex size-full min-h-0 flex-col gap-2">
      <div className="min-h-0 flex-1">{media}</div>
      <GroupStrip group={group} currentId={file.id} onOpen={openItem} />
    </div>
  ) : media

  const sidePanel = (
    <Tabs value={tab} onValueChange={setTab} className="h-full min-h-0 gap-0">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <TabsList>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="info">Info</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        {tab === 'tags' && <SaveIndicator state={saveState} />}
      </div>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="outline" size="sm" className="min-w-0 flex-1 justify-start" onClick={() => setMoving(true)} aria-label={`Folder: ${folderLabel}. Change folder`}>
          <RiFolderOpenLine data-icon="inline-start" />
          <span className="truncate">{folderLabel}</span>
          <Kbd className="ml-auto">Shift+M</Kbd>
        </Button>
        {file.folder_id != null && (
          <Button variant="ghost" size="icon-sm" aria-label="Remove from folder" title="Remove from folder (move to Unfiled)" onClick={() => bulk.moveToFolder([file], null, 'Unfiled')}>
            <RiCloseLine />
          </Button>
        )}
      </div>
      <TabsContent value="tags" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <div className="p-3"><TagEditor file={file} onSaved={applyUpdate} onSaveStateChange={setSaveState} /></div>
        </ScrollArea>
      </TabsContent>
      <TabsContent value="notes" className="min-h-0 flex-1 p-3"><NotesEditor file={file} onSaved={applyUpdate} /></TabsContent>
      <TabsContent value="info" className="min-h-0 flex-1">
        <ScrollArea className="h-full"><div className="p-3"><InfoList file={file} folderLabel={folderLabel} onMove={() => setMoving(true)}
          groupSection={file.group_id != null ? <GroupInfo file={file} group={group} onRename={groupActions.rename} onRemove={groupActions.remove} onUngroup={groupActions.ungroup} /> : null} /></div></ScrollArea>
      </TabsContent>
      <TabsContent value="history" className="min-h-0 flex-1">
        <ScrollArea className="h-full"><HistoryPanel fileId={file.id} /></ScrollArea>
      </TabsContent>
    </Tabs>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      {isMobile ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="aspect-video w-full p-2">{media}</div>
          {file.group_id != null && clipsOf(group).length > 1 && <div className="px-2"><GroupStrip group={group} currentId={file.id} onOpen={openItem} /></div>}
          <div className="h-[28rem]">{sidePanel}</div>
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          id="player-layout"
          defaultLayout={layout.defaultLayout}
          onLayoutChanged={layout.onLayoutChanged}
          className="min-h-0 flex-1"
        >
          <ResizablePanel id="side" defaultSize="28%" minSize="20%" maxSize="50%">{sidePanel}</ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="main" minSize="40%"><div className="size-full p-3">{mediaWithStrip}</div></ResizablePanel>
        </ResizablePanelGroup>
      )}

      <MoveToFolderDialog
        open={moving}
        onOpenChange={setMoving}
        title="Move to folder"
        onSelect={(fid, f) => bulk.moveToFolder([file], fid, f?.name)}
      />
    </div>
  )
}
