import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { RiFilmLine, RiFolderOpenLine, RiSearchLine, RiAddCircleLine } from '@remixicon/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.jsx'
import { Skeleton } from '@/components/ui/skeleton.jsx'
import { Spinner } from '@/components/ui/spinner.jsx'
import { Switch } from '@/components/ui/switch.jsx'
import { Label } from '@/components/ui/label.jsx'
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb.jsx'
import {
  Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from '@/components/ui/empty.jsx'
import MediaCard from '@/components/MediaCard.jsx'
import MoveToFolderDialog from '@/components/MoveToFolderDialog.jsx'
import LibraryToolbar, { GRID_SIZES } from '@/components/library/LibraryToolbar.jsx'
import FilterBar from '@/components/library/FilterBar.jsx'
import BulkBar from '@/components/library/BulkBar.jsx'
import PlayerDialog from '@/components/library/PlayerDialog.jsx'
import { getFiles, getUsers, patchFile } from '@/api/client.js'
import { useAuth } from '@/context/AuthContext.jsx'
import { useTaxonomy } from '@/hooks/useTaxonomy.js'
import { useFolders } from '@/hooks/useFolders.js'
import { useBulkActions } from '@/hooks/useBulkActions.js'
import { useFileCounts } from '@/hooks/useInboxCount.js'
import { setDragFiles } from '@/lib/dnd.js'
import { folderPath } from '@/lib/folders.js'

const PAGE_SIZE = 100
const SCROLL_KEY = 'library:scrollTop'

export default function Library() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const { groups, tags } = useTaxonomy()
  const { data: folderData } = useFolders()
  const { data: counts } = useFileCounts()
  const bulk = useBulkActions()
  const { enabled: loginOn, isAdmin, user: me } = useAuth()

  // Filters live in the URL: shareable, and they survive opening a video and coming back.
  const selectedTags = useMemo(
    () => new Set((searchParams.get('tags') || '').split(',').filter(Boolean).map(Number)),
    [searchParams]
  )
  const sort = searchParams.get('sort') || 'date_added'
  const order = searchParams.get('order') || 'desc'
  const search = searchParams.get('search') || ''
  const favorites = searchParams.get('favorites') === '1'
  const untagged = searchParams.get('untagged') === '1'
  const ai = searchParams.get('source') === 'agent'
  const uploader = searchParams.get('uploader') || ''
  const folder = searchParams.get('folder') || ''
  const subfolders = searchParams.get('subfolders') !== '0'
  const gridSize = (() => {
    let saved = null
    try { saved = localStorage.getItem('gridSize') } catch { /* ignore */ }
    const raw = searchParams.get('grid') ?? saved
    const i = raw == null || raw === '' ? NaN : Number(raw)
    return Number.isInteger(i) && i >= 0 && i < GRID_SIZES.length ? i : 2
  })()

  const updateParams = useCallback((mutate) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      mutate(next)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => { setSearchInput(search) }, [search])
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== search) updateParams((p) => (searchInput ? p.set('search', searchInput) : p.delete('search')))
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput, search, updateParams])

  const queryParams = useMemo(() => ({
    view: 'all',
    sort,
    order,
    tags: [...selectedTags].join(',') || undefined,
    search: search || undefined,
    favorites: favorites ? '1' : undefined,
    untagged: untagged ? '1' : undefined,
    source: ai ? 'agent' : undefined,
    uploader: uploader || undefined,
    folder: folder || undefined,
    subfolders: folder && folder !== 'none' ? (subfolders ? '1' : '0') : undefined,
  }), [selectedTags, sort, order, search, favorites, untagged, ai, uploader, folder, subfolders])

  const query = useInfiniteQuery({
    queryKey: ['files', 'library', queryParams],
    queryFn: ({ pageParam }) => getFiles({ ...queryParams, page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (all.length * PAGE_SIZE < last.total ? all.length + 1 : undefined),
  })
  const files = useMemo(() => {
    const seen = new Set()
    return (query.data?.pages ?? []).flatMap((p) => p.files).filter((f) => !seen.has(f.id) && seen.add(f.id))
  }, [query.data])
  const total = query.data?.pages[0]?.total ?? 0

  // People to offer in "Uploaded by". Only admins may list users; everyone else gets themselves plus
  // whoever appears on files loaded so far.
  const { data: userData } = useQuery({ queryKey: ['users'], queryFn: getUsers, enabled: loginOn && isAdmin })
  const seenUploaders = useRef(new Map())
  for (const f of files) if (f.uploader) seenUploaders.current.set(f.uploader.id, f.uploader)
  if (me) seenUploaders.current.set(me.id, me)
  const uploaderOptions = (loginOn && isAdmin && userData ? userData.users : [...seenUploaders.current.values()])
    .slice().sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)))
  const filesRef = useRef(files)
  filesRef.current = files

  // ----- Scrolling: infinite load + restore position after coming back from the player
  const scrollRef = useRef(null)
  const sentinelRef = useRef(null)
  const restoredRef = useRef(false)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query

  useLayoutEffect(() => {
    if (restoredRef.current || !query.data) return
    restoredRef.current = true
    const saved = sessionStorage.getItem(SCROLL_KEY)
    if (saved && scrollRef.current) scrollRef.current.scrollTop = parseInt(saved, 10)
  }, [query.data])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && !isFetchingNextPage) fetchNextPage() },
      { root: scrollRef.current, rootMargin: '600px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, files.length])

  // ----- Selection (with shift-click range)
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const anchorRef = useRef(null)
  const selectMode = selecting || selectedIds.size > 0
  const selectedFiles = useMemo(() => files.filter((f) => selectedIds.has(f.id)), [files, selectedIds])
  const selectedRef = useRef(selectedIds)
  selectedRef.current = selectedIds

  // The selection does not survive a change of view.
  const viewKey = JSON.stringify(queryParams)
  useEffect(() => { setSelectedIds(new Set()); anchorRef.current = null }, [viewKey])

  const handleSelect = useCallback((file, { shift }) => {
    const list = filesRef.current
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const anchor = anchorRef.current
      if (shift && anchor != null) {
        const a = list.findIndex((f) => f.id === anchor)
        const b = list.findIndex((f) => f.id === file.id)
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          for (let i = lo; i <= hi; i++) next.add(list[i].id)
          return next
        }
      }
      next.has(file.id) ? next.delete(file.id) : next.add(file.id)
      anchorRef.current = file.id
      return next
    })
  }, [])

  const clearSelection = useCallback(() => { setSelectedIds(new Set()); setSelecting(false); anchorRef.current = null }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || selectedRef.current.size === 0) return
      if (e.defaultPrevented || document.querySelector('[role=dialog],[role=menu],[data-open]')) return
      clearSelection()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [clearSelection])

  // ----- Card actions
  const [playing, setPlaying] = useState(null)
  const [moveTarget, setMoveTarget] = useState(null) // array of file objects

  const handleFavorite = useCallback(async (file) => {
    try {
      await patchFile(file.id, { is_favorite: file.is_favorite ? 0 : 1 })
      qc.invalidateQueries({ queryKey: ['files'] })
    } catch (err) { toast.error(err.message) }
  }, [qc])

  const handleDragStart = useCallback((e, file) => {
    const sel = selectedRef.current
    const list = sel.has(file.id) && sel.size > 1 ? filesRef.current.filter((f) => sel.has(f.id)) : [file]
    setDragFiles(e, list)
  }, [])

  const handleMoveOne = useCallback((file) => setMoveTarget([file]), [])
  const handleDeleteOne = useCallback((file) => { setSelectedIds((s) => { const n = new Set(s); n.delete(file.id); return n }); return bulk.deleteFiles([file]) }, [bulk])
  const handleMarkReviewedOne = useCallback((file) => bulk.markReviewed([file]), [bulk])

  const handleRandom = () => {
    if (!files.length) return
    navigate(`/player/${files[Math.floor(Math.random() * files.length)].id}?${searchParams.toString()}`)
  }

  // ----- Filter handlers
  const toggleTag = (id) => updateParams((p) => {
    const set = new Set((p.get('tags') || '').split(',').filter(Boolean).map(Number))
    const adding = !set.has(id)
    set.has(id) ? set.delete(id) : set.add(id)
    set.size ? p.set('tags', [...set].join(',')) : p.delete('tags')
    if (adding) p.delete('untagged') // "no tags" and a specific tag contradict each other
  })
  const toggleFlag = (flag) => updateParams((p) => {
    const key = flag === 'ai' ? 'source' : flag
    const val = flag === 'ai' ? 'agent' : '1'
    if (p.get(key) === val) p.delete(key)
    else {
      p.set(key, val)
      if (flag === 'untagged') p.delete('tags')
    }
  })
  const clearFilters = () => updateParams((p) => { ['tags', 'favorites', 'untagged', 'source', 'search', 'uploader'].forEach((k) => p.delete(k)) })
  const filtersActive = selectedTags.size > 0 || favorites || untagged || ai || !!search || !!uploader

  const folders = folderData?.folders ?? []
  const folderParts = folder && folder !== 'none' ? folderPath(folders, Number(folder)) : []
  const folderName = folder === 'none' ? 'Unfiled' : folderParts[folderParts.length - 1]
  const title = folderName || 'Library'
  const gridCols = GRID_SIZES[gridSize].cols

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 px-4 pb-3 pt-4">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
          <div className="min-w-0">
            {folder && (
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem><BreadcrumbLink render={<Link to="/library" />}>Library</BreadcrumbLink></BreadcrumbItem>
                  {folder === 'none' ? (
                    <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>Unfiled</BreadcrumbPage></BreadcrumbItem></>
                  ) : folderParts.map((part, i) => (
                    <React.Fragment key={i}>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem><BreadcrumbPage>{part}</BreadcrumbPage></BreadcrumbItem>
                    </React.Fragment>
                  ))}
                </BreadcrumbList>
              </Breadcrumb>
            )}
            <h1 className="text-lg font-semibold leading-tight tracking-tight">{title}</h1>
          </div>
          <p className="pb-0.5 text-xs text-muted-foreground" aria-live="polite">
            {query.isLoading ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? 'file' : 'files'}`}
          </p>
          {folder && folder !== 'none' && (
            <div className="ml-auto flex items-center gap-2 pb-0.5">
              <Switch
                id="subfolders"
                checked={subfolders}
                onCheckedChange={(v) => updateParams((p) => (v ? p.delete('subfolders') : p.set('subfolders', '0')))}
              />
              <Label htmlFor="subfolders" className="text-xs">Include subfolders</Label>
            </div>
          )}
        </div>

        <LibraryToolbar
          searchInput={searchInput}
          onSearchInput={setSearchInput}
          sort={sort}
          order={order}
          onSort={(v) => updateParams((p) => { p.set('sort', v); if (v === 'uploader') p.set('order', 'asc') })}
          onOrder={() => updateParams((p) => p.set('order', order === 'desc' ? 'asc' : 'desc'))}
          gridSize={gridSize}
          onGridSize={(i) => { try { localStorage.setItem('gridSize', String(i)) } catch { /* ignore */ } updateParams((p) => p.set('grid', String(i))) }}
          selecting={selectMode}
          onToggleSelect={(on) => { setSelecting(on); if (!on) { setSelectedIds(new Set()) } }}
          onRandom={handleRandom}
          canRandom={files.length > 0}
        />

        <FilterBar
          groups={groups}
          tags={tags}
          filters={{ tags: selectedTags, favorites, untagged, ai, uploader }}
          onToggleTag={toggleTag}
          onToggleFlag={toggleFlag}
          onClear={clearFilters}
          uploaderOptions={uploaderOptions}
          onSetUploader={loginOn ? (v) => updateParams((p) => (v ? p.set('uploader', v) : p.delete('uploader'))) : undefined}
        />
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => { try { sessionStorage.setItem(SCROLL_KEY, String(e.currentTarget.scrollTop)) } catch { /* ignore */ } }}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4"
      >
        {query.isLoading ? (
          <div className={`grid ${gridCols} gap-3 pb-4`} aria-busy="true">
            {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="aspect-[4/3] rounded-xl" />)}
          </div>
        ) : query.isError ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Could not load the library</EmptyTitle>
              <EmptyDescription>{query.error.message}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent><Button onClick={() => query.refetch()}>Try again</Button></EmptyContent>
          </Empty>
        ) : files.length === 0 ? (
          <LibraryEmpty
            filtersActive={filtersActive}
            folder={folder}
            libraryEmpty={counts?.total === 0}
            onClear={clearFilters}
          />
        ) : (
          <div>
            <div className={`grid ${gridCols} gap-3 pb-4`}>
              {files.map((file) => (
                <MediaCard
                  key={file.id}
                  file={file}
                  selectMode={selectMode}
                  selected={selectedIds.has(file.id)}
                  onSelect={handleSelect}
                  onFavoriteToggle={handleFavorite}
                  onPlay={setPlaying}
                  onDragStartFiles={handleDragStart}
                  onMove={handleMoveOne}
                  onMarkReviewed={handleMarkReviewedOne}
                  onDelete={handleDeleteOne}
                />
              ))}
            </div>
            <div ref={sentinelRef} className="flex h-10 items-center justify-center pb-4 text-xs text-muted-foreground">
              {isFetchingNextPage ? <Spinner /> : hasNextPage ? null : files.length > PAGE_SIZE ? 'End of library' : null}
            </div>
          </div>
        )}

        {selectedIds.size > 0 && (
          <BulkBar
            files={selectedFiles}
            total={total}
            groups={groups}
            onClear={clearSelection}
            onSelectAll={() => setSelectedIds(new Set(files.map((f) => f.id)))}
            onAddTag={bulk.addTag}
            onRemoveTag={bulk.removeTag}
            onMove={() => setMoveTarget(selectedFiles)}
            onFavorite={(v) => bulk.setFavorite(selectedFiles, v)}
            onMarkReviewed={async () => { if (await bulk.markReviewed(selectedFiles)) clearSelection() }}
            onDelete={async () => { if (await bulk.deleteFiles(selectedFiles)) clearSelection() }}
          />
        )}
      </div>

      <MoveToFolderDialog
        open={!!moveTarget}
        onOpenChange={(o) => !o && setMoveTarget(null)}
        title={`Move ${moveTarget?.length ?? 0} ${moveTarget?.length === 1 ? 'file' : 'files'}`}
        onSelect={async (id, f) => {
          const ok = await bulk.moveToFolder(moveTarget, id, f?.name)
          if (ok && moveTarget.length > 1) clearSelection()
        }}
      />
      <PlayerDialog file={playing} onOpenChange={(o) => !o && setPlaying(null)} />
    </div>
  )
}

function LibraryEmpty({ filtersActive, folder, libraryEmpty, onClear }) {
  if (filtersActive) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><RiSearchLine /></EmptyMedia>
          <EmptyTitle>No files match</EmptyTitle>
          <EmptyDescription>Nothing fits the current search and filters.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent><Button variant="outline" onClick={onClear}>Clear filters</Button></EmptyContent>
      </Empty>
    )
  }
  if (folder) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><RiFolderOpenLine /></EmptyMedia>
          <EmptyTitle>{folder === 'none' ? 'Everything is filed' : 'This folder is empty'}</EmptyTitle>
          <EmptyDescription>
            {folder === 'none'
              ? 'Every file lives in a folder.'
              : 'Drag media from the library onto this folder in the sidebar, or select files and use Move.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon"><RiFilmLine /></EmptyMedia>
        <EmptyTitle>{libraryEmpty ? 'Your library is empty' : 'Nothing here yet'}</EmptyTitle>
        <EmptyDescription>Upload files, import from a URL, or drop media into the watched folder and scan.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/add-media" />}><RiAddCircleLine data-icon="inline-start" /> Add media</Button>
      </EmptyContent>
    </Empty>
  )
}
