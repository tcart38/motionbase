import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RiArrowLeftLine, RiArrowRightLine, RiCheckLine, RiCloseLine, RiDownloadLine, RiImageLine, RiPencilLine,
  RiStarFill, RiStarLine, RiCheckDoubleLine, RiFolderLine, RiSparklingLine,
} from '@remixicon/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.jsx'
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
import MoveToFolderDialog from '@/components/MoveToFolderDialog.jsx'
import { getFile, getNextFile, patchFile, streamUrl, thumbnailUrl, downloadUrl } from '@/api/client.js'
import { useFolders } from '@/hooks/useFolders.js'
import { useBulkActions } from '@/hooks/useBulkActions.js'
import { useIsMobile } from '@/hooks/use-mobile.js'
import { folderPath } from '@/lib/folders.js'

function formatBytes(bytes) {
  if (!bytes) return null
  const units = ['B', 'KB', 'MB', 'GB']
  let val = bytes
  let i = 0
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
  return `${val.toFixed(i === 0 || val >= 10 ? 0 : 1)} ${units[i]}`
}

function InfoList({ file, folderLabel, onMove }) {
  const rows = [
    ['Type', file.file_type],
    ['Dimensions', file.width ? `${file.width}×${file.height}` : '—'],
    ['Duration', file.duration ? `${file.duration.toFixed(2)}s` : '—'],
    ['Size', formatBytes(file.file_size) ?? '—'],
    ['Frame rate', file.fps ? `${Math.round(file.fps * 100) / 100} fps` : '—'],
    ['Aspect ratio', file.aspect_ratio ?? '—'],
    ['Added', file.date_added ? new Date(file.date_added.replace(' ', 'T') + 'Z').toLocaleDateString() : '—'],
  ]
  const reviewed = file.reviewed_at
    ? `Reviewed${file.reviewed_by && file.reviewed_by !== 'user' ? ` (${file.reviewed_by})` : ''}`
    : file.agent_reviewed_at ? 'Reviewed by AI, awaiting your confirmation' : 'Not reviewed yet'
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono">{v}</dd>
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
    </dl>
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
  const layout = useDefaultLayout({ id: 'player-layout', storage: window.localStorage })

  const applyUpdate = useCallback((updated) => {
    qc.setQueryData(['file', String(updated.id)], updated)
    qc.invalidateQueries({ queryKey: ['files'] })
    qc.invalidateQueries({ queryKey: ['counts'] })
  }, [qc])

  useEffect(() => { setTab('tags') }, [id])

  const goNext = useCallback(async () => {
    setNextLoading(true)
    try {
      const { nextId } = await getNextFile(id, Object.fromEntries(searchParams))
      navigate(`/player/${nextId}?${searchParams.toString()}`)
    } catch {
      toast.info('No other files in this view')
    } finally { setNextLoading(false) }
  }, [id, searchParams, navigate])

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

  const sidePanel = (
    <Tabs value={tab} onValueChange={setTab} className="h-full min-h-0 gap-0">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <TabsList>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="info">Info</TabsTrigger>
        </TabsList>
        {tab === 'tags' && <SaveIndicator state={saveState} />}
      </div>
      <TabsContent value="tags" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <div className="p-3"><TagEditor file={file} onSaved={applyUpdate} onSaveStateChange={setSaveState} /></div>
        </ScrollArea>
      </TabsContent>
      <TabsContent value="notes" className="min-h-0 flex-1 p-3"><NotesEditor file={file} onSaved={applyUpdate} /></TabsContent>
      <TabsContent value="info" className="min-h-0 flex-1">
        <ScrollArea className="h-full"><div className="p-3"><InfoList file={file} folderLabel={folderLabel} onMove={() => setMoving(true)} /></div></ScrollArea>
      </TabsContent>
    </Tabs>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      {isMobile ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="aspect-video w-full p-2">{media}</div>
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
          <ResizablePanel id="main" minSize="40%"><div className="size-full p-3">{media}</div></ResizablePanel>
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
