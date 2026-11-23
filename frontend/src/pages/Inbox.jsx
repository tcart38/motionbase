import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import {
  RiInboxLine, RiCheckDoubleLine, RiSkipForwardLine, RiArrowGoBackLine, RiFolderTransferLine, RiFolderLine,
  RiImageLine, RiArrowUpSLine, RiArrowDownSLine, RiSparklingLine,
} from '@remixicon/react'
import { Button } from '@/components/ui/button.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Kbd } from '@/components/ui/kbd.jsx'
import { ScrollArea } from '@/components/ui/scroll-area.jsx'
import { Skeleton } from '@/components/ui/skeleton.jsx'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group.jsx'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty.jsx'
import VideoPlayer from '@/components/VideoPlayer.jsx'
import TagEditor from '@/components/TagEditor.jsx'
import NotesEditor, { SaveIndicator } from '@/components/NotesEditor.jsx'
import MoveToFolderDialog from '@/components/MoveToFolderDialog.jsx'
import QueueList from '@/components/inbox/QueueList.jsx'
import QuickTagDialog from '@/components/inbox/QuickTagDialog.jsx'
import { getFiles, streamUrl, thumbnailUrl } from '@/api/client.js'
import { useTaxonomy } from '@/hooks/useTaxonomy.js'
import { useFolders } from '@/hooks/useFolders.js'
import { useBulkActions } from '@/hooks/useBulkActions.js'
import { useFileCounts } from '@/hooks/useInboxCount.js'
import { folderPath } from '@/lib/folders.js'
import { uploaderLabel } from '@/lib/people.js'
import { useAuth } from '@/context/AuthContext.jsx'

const PAGE_SIZE = 50
const FILTERS = [
  { value: 'all', label: 'All', status: undefined },
  { value: 'ai', label: 'AI to confirm', status: 'needs_review' },
  { value: 'new', label: 'Untouched', status: 'pending' },
]
// Keys the Inbox binds; the video player must leave these alone.
const RESERVED = ['k', 'm', 'l']

const SHORTCUTS = [
  ['J / K', 'Next / previous'],
  ['E', 'Mark reviewed, next'],
  ['A', 'Accept AI tags (same as E)'],
  ['S', 'Skip'],
  ['Z', 'Undo'],
  ['T', 'Find a tag'],
  ['M', 'Move to folder'],
  ['1 - 9', 'Toggle tag'],
]

export default function Inbox() {
  const qc = useQueryClient()
  const bulk = useBulkActions()
  const { enabled: loginOn } = useAuth()
  const { groups } = useTaxonomy()
  const { data: folderData } = useFolders()
  const { data: counts } = useFileCounts()

  const [filter, setFilter] = useState('all')
  const status = FILTERS.find((f) => f.value === filter).status

  const query = useInfiniteQuery({
    queryKey: ['files', 'inbox', status ?? 'all'],
    queryFn: ({ pageParam }) => getFiles({ view: 'inbox', status, sort: 'date_added', order: 'desc', page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (all.length * PAGE_SIZE < last.total ? all.length + 1 : undefined),
  })
  const files = useMemo(() => {
    const seen = new Set()
    return (query.data?.pages ?? []).flatMap((p) => p.files).filter((f) => !seen.has(f.id) && seen.add(f.id))
  }, [query.data])
  const total = query.data?.pages[0]?.total ?? 0

  // ----- Current file
  const [currentId, setCurrentId] = useState(null)
  const lastIndex = useRef(0)
  const idx = files.findIndex((f) => f.id === currentId)
  const current = idx >= 0 ? files[idx] : null

  // Keep a valid selection: after the current file leaves the queue, land on the neighbour.
  useEffect(() => {
    if (!files.length) { setCurrentId(null); return }
    if (!files.some((f) => f.id === currentId)) {
      setCurrentId(files[Math.min(lastIndex.current, files.length - 1)].id)
    }
  }, [files, currentId])
  useEffect(() => { if (idx >= 0) lastIndex.current = idx }, [idx])

  const go = useCallback((delta) => {
    if (!files.length) return
    const i = idx < 0 ? 0 : Math.max(0, Math.min(files.length - 1, idx + delta))
    setCurrentId(files[i].id)
  }, [files, idx])

  // ----- Actions
  const [moving, setMoving] = useState(false)
  const [quickTag, setQuickTag] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const toggleRef = useRef(null)
  const lastReviewed = useRef(null)

  const confirm = useCallback(async () => {
    if (!current) return
    const nextId = (files[idx + 1] ?? files[idx - 1])?.id ?? null
    const reviewed = current.id
    if (await bulk.markReviewed([current])) {
      lastReviewed.current = reviewed
      setCurrentId(nextId)
    }
  }, [current, files, idx, bulk])

  const undo = useCallback(async () => {
    if (await bulk.undoLast()) {
      // Wait for the queue to include the restored file before selecting it.
      await qc.invalidateQueries({ queryKey: ['files'] })
      if (lastReviewed.current != null) setCurrentId(lastReviewed.current)
    }
  }, [bulk, qc])

  const nonSystemTags = useMemo(() => groups.filter((g) => !g.is_system).flatMap((g) => g.tags), [groups])
  const hotkeys = useMemo(() => new Map(nonSystemTags.slice(0, 9).map((t, i) => [t.id, String(i + 1)])), [nonSystemTags])

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      if (t instanceof HTMLElement && t.closest('input, textarea, select, [contenteditable=true], [role=dialog], [role=menu], [role=listbox]')) return
      if (document.querySelector('[role=dialog][data-open], [role=alertdialog]')) return
      const k = e.key.toLowerCase()
      const run = {
        j: () => go(1), k: () => go(-1),
        e: confirm, a: confirm,
        s: () => go(1),
        z: undo,
        t: () => current && setQuickTag(true),
        m: () => current && setMoving(true),
      }[k]
      if (run) { e.preventDefault(); run(); return }
      if (/^[1-9]$/.test(k) && current) {
        const tag = nonSystemTags[Number(k) - 1]
        if (tag && toggleRef.current) { e.preventDefault(); toggleRef.current(tag.id) }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [go, confirm, undo, current, nonSystemTags])

  const selectedTagIds = useMemo(() => new Set((current?.tags ?? []).map((t) => t.id)), [current])
  const onSaved = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['files'] })
    qc.invalidateQueries({ queryKey: ['counts'] })
  }, [qc])

  const folders = folderData?.folders ?? []
  const folderLabel = !current || current.folder_id == null ? 'Unfiled' : folderPath(folders, current.folder_id).join(' / ')

  // ----- Render
  const filterBar = (
    <ToggleGroup
      value={[filter]}
      onValueChange={(v) => v[0] && setFilter(v[0])}
      variant="outline"
      spacing={0}
      aria-label="Filter the inbox"
    >
      {FILTERS.map((f) => (
        <ToggleGroupItem key={f.value} value={f.value} size="sm">
          {f.label}
          {f.value === 'ai' && counts?.needs_review > 0 ? <Badge className="ml-1 h-4 px-1">{counts.needs_review}</Badge> : null}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )

  if (!query.isLoading && files.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 px-4 pt-4"><h1 className="text-lg font-semibold tracking-tight">Inbox</h1>{filterBar}</div>
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon"><RiInboxLine /></EmptyMedia>
            <EmptyTitle>{filter === 'all' ? 'Inbox zero' : 'Nothing in this view'}</EmptyTitle>
            <EmptyDescription>
              {filter === 'all'
                ? 'Everything has been reviewed. New uploads and scanned files will show up here.'
                : 'No files match this filter. Try All.'}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button variant="outline" render={<Link to="/add-media" />}>Add media</Button>
            <Button render={<Link to="/library" />}>Open library</Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  const isVideo = current?.file_type === 'video'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2.5">
        <h1 className="text-lg font-semibold tracking-tight">Inbox</h1>
        <p className="text-xs text-muted-foreground" aria-live="polite">{query.isLoading ? 'Loading…' : `${total} to review`}</p>
        <div className="ml-auto">{filterBar}</div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)_21rem]">
        {/* Queue (desktop) */}
        <aside className="hidden min-h-0 border-r lg:block" aria-label="Queue">
          <ScrollArea className="h-full">
            <QueueList
              files={files}
              currentId={currentId}
              onSelect={setCurrentId}
              loading={query.isLoading}
              hasMore={!!query.hasNextPage}
              loadingMore={query.isFetchingNextPage}
              onLoadMore={query.fetchNextPage}
            />
          </ScrollArea>
        </aside>

        {/* Preview + actions */}
        <section className="flex min-h-0 flex-col" aria-label="Preview">
          {!current ? (
            <div className="p-4"><Skeleton className="aspect-video w-full" /></div>
          ) : (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-medium" title={current.filename}>{current.filename}</h2>
                  <p className="text-xs text-muted-foreground">
                    {idx + 1} of {files.length}{query.hasNextPage ? '+' : ''}
                    {(loginOn || current.uploader) && uploaderLabel(current) && <> · added by {uploaderLabel(current)}</>}
                    {current.agent_reviewed_at && <> · <RiSparklingLine className="-mt-0.5 inline size-3 text-primary" /> reviewed by AI</>}
                  </p>
                </div>
                <div className="flex items-center gap-1 lg:hidden">
                  <Button variant="outline" size="icon" onClick={() => go(-1)} disabled={idx <= 0} aria-label="Previous file"><RiArrowUpSLine /></Button>
                  <Button variant="outline" size="icon" onClick={() => go(1)} disabled={idx >= files.length - 1} aria-label="Next file"><RiArrowDownSLine /></Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 px-4 pb-2">
                {isVideo ? (
                  <VideoPlayer file={current} autoPlay reservedKeys={RESERVED} />
                ) : (
                  <div className="flex size-full items-center justify-center overflow-hidden rounded-xl bg-muted">
                    {thumbnailUrl(current) ? (
                      <img src={streamUrl(current.id)} alt={current.filename} className="max-h-full max-w-full object-contain" />
                    ) : <RiImageLine className="size-8 text-muted-foreground" />}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-2.5">
                <Button onClick={confirm}>
                  <RiCheckDoubleLine data-icon="inline-start" /> {current.agent_reviewed_at ? 'Confirm' : 'Mark reviewed'} <Kbd className="ml-1 bg-primary-foreground/20 text-primary-foreground">E</Kbd>
                </Button>
                <Button variant="outline" onClick={() => go(1)} disabled={idx >= files.length - 1}>
                  <RiSkipForwardLine data-icon="inline-start" /> Skip <Kbd className="ml-1">S</Kbd>
                </Button>
                <Button variant="outline" onClick={() => setMoving(true)}>
                  <RiFolderTransferLine data-icon="inline-start" /> Move <Kbd className="ml-1">M</Kbd>
                </Button>
                <Button variant="ghost" onClick={undo}><RiArrowGoBackLine data-icon="inline-start" /> Undo <Kbd className="ml-1">Z</Kbd></Button>
                <span className="ml-auto flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <RiFolderLine className="size-3.5 shrink-0" /><span className="truncate">{folderLabel}</span>
                </span>
              </div>
            </>
          )}
        </section>

        {/* Tags + notes */}
        <aside className="min-h-0 border-t lg:col-span-2 lg:border-l-0 xl:col-span-1 xl:border-l xl:border-t-0" aria-label="Tags and notes">
          <ScrollArea className="h-full">
            {current && (
              <div className="space-y-5 p-4">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</h2>
                    <SaveIndicator state={saveState} />
                  </div>
                  <TagEditor
                    file={current}
                    onSaved={onSaved}
                    onSaveStateChange={setSaveState}
                    hotkeys={hotkeys}
                    toggleRef={toggleRef}
                    showNewCategory={false}
                  />
                </div>
                <div>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</h2>
                  <div className="h-36"><NotesEditor file={current} onSaved={onSaved} /></div>
                </div>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">Keyboard shortcuts</summary>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    {SHORTCUTS.map(([k, d]) => (
                      <React.Fragment key={k}><dt><Kbd>{k}</Kbd></dt><dd>{d}</dd></React.Fragment>
                    ))}
                  </dl>
                </details>
              </div>
            )}
          </ScrollArea>
        </aside>
      </div>

      <MoveToFolderDialog
        open={moving}
        onOpenChange={setMoving}
        title="Move to folder"
        onSelect={(fid, f) => current && bulk.moveToFolder([current], fid, f?.name)}
      />
      <QuickTagDialog
        open={quickTag}
        onOpenChange={setQuickTag}
        groups={groups}
        selectedIds={selectedTagIds}
        onToggle={(id) => toggleRef.current?.(id)}
      />
    </div>
  )
}
