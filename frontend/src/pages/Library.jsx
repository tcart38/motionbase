import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, X, ChevronDown, LayoutGrid, Star, CheckSquare, Square } from 'lucide-react'
import { getFiles, getCategories, getTags, patchFile } from '../api/client.js'
import MediaCard from '../components/MediaCard.jsx'

const SORT_OPTIONS = [
  { value: 'date_added', label: 'Date Added' },
  { value: 'filename', label: 'Filename' },
  { value: 'duration', label: 'Duration' },
]

// Grid size configs: [cols-sm, cols-md, cols-lg, cols-xl]
const GRID_SIZES = [
  { label: 'XS', cols: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10' },
  { label: 'S',  cols: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7' },
  { label: 'M',  cols: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5' },
  { label: 'L',  cols: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4' },
  { label: 'XL', cols: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3' },
]

function CategoryFilter({ cat, tags, selectedTags, onToggle }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const activeCount = tags.filter((t) => selectedTags.has(t.id)).length

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium
          transition-colors duration-150 select-none cursor-pointer
          ${activeCount > 0
            ? 'bg-brand border-brand text-white'
            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/[0.15]'
          }`}
      >
        {cat.name}
        {activeCount > 0 && (
          <span className="bg-white/25 text-white text-xs rounded-full px-1.5 py-0 leading-4">
            {activeCount}
          </span>
        )}
        <ChevronDown
          size={13}
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''} ${activeCount > 0 ? 'text-white/70' : 'text-slate-400'}`}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-20 card p-3 min-w-[160px] shadow-xl
                        border border-slate-200 dark:border-white/[0.08]">
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => onToggle(tag.id)}
                className={`tag-btn ${selectedTags.has(tag.id) ? 'tag-btn-active' : ''}`}
              >
                {tag.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Library() {
  const [data, setData] = useState({ files: [], total: 0 })
  const [categories, setCategories] = useState([])
  const [allTags, setAllTags] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())

  // Filters/view live in the URL so they survive navigating into a video and back
  // (and are shareable/bookmarkable). The URL is the single source of truth.
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchInput, setSearchInput] = useState(() => searchParams.get('search') || '')
  const selectedTags = useMemo(
    () => new Set((searchParams.get('tags') || '').split(',').filter(Boolean).map(Number)),
    [searchParams]
  )
  const sort = searchParams.get('sort') || 'date_added'
  const order = searchParams.get('order') || 'desc'
  const search = searchParams.get('search') || ''
  const favorites = searchParams.get('favorites') === '1'
  const gridSizeIdx = (() => {
    const i = Number(searchParams.get('grid') ?? localStorage.getItem('gridSize'))
    return Number.isInteger(i) && i >= 0 && i < GRID_SIZES.length ? i : 2
  })()

  // Mutate the query string without stacking a history entry per change.
  const updateParams = useCallback((mutate) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      mutate(next)
      return next
    }, { replace: true })
  }, [setSearchParams])

  useEffect(() => {
    Promise.all([getCategories(), getTags()]).then(([cats, tags]) => {
      setCategories(cats)
      setAllTags(tags)
    })
  }, [])

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getFiles({
        view: 'all',
        sort,
        order,
        tags: [...selectedTags].join(',') || undefined,
        search: search || undefined,
        favorites: favorites ? '1' : undefined,
        limit: 200,
      })
      setData(result)
    } finally {
      setLoading(false)
    }
  }, [selectedTags, sort, order, search, favorites])

  useEffect(() => { fetchFiles() }, [fetchFiles])

  useEffect(() => {
    const t = setTimeout(() => {
      updateParams((p) => { if (searchInput) p.set('search', searchInput); else p.delete('search') })
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput, updateParams])

  const toggleTag = (id) => updateParams((p) => {
    const set = new Set((p.get('tags') || '').split(',').filter(Boolean).map(Number))
    set.has(id) ? set.delete(id) : set.add(id)
    set.size ? p.set('tags', [...set].join(',')) : p.delete('tags')
  })

  const clearFilters = () => updateParams((p) => p.delete('tags'))

  const toggleSelectMode = () => {
    setSelectMode(v => !v)
    setSelectedIds(new Set())
  }

  const handleFavoriteToggle = async (fileId, newVal) => {
    const updated = await patchFile(fileId, { is_favorite: newVal ? 1 : 0 })
    setData(prev => ({ ...prev, files: prev.files.map(f => f.id === fileId ? updated : f) }))
  }

  const handleBulkTag = async (tagId, add) => {
    const selectedFiles = data.files.filter(f => selectedIds.has(f.id))
    const results = await Promise.all(
      selectedFiles.map(f => {
        const ids = new Set(f.tags.map(t => t.id))
        add ? ids.add(tagId) : ids.delete(tagId)
        return patchFile(f.id, { tag_ids: [...ids] })
      })
    )
    setData(prev => ({
      ...prev,
      files: prev.files.map(f => results.find(r => r.id === f.id) || f),
    }))
  }

  const gridCols = GRID_SIZES[gridSizeIdx].cols

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-6 pt-5 pb-4 flex-shrink-0 space-y-3">
        {/* Top row: title + search + sort + grid size */}
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 leading-none">Library</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{data.total} files</p>
          </div>

          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search files…"
              className="input pl-8 pr-7 text-sm py-1.5 w-full"
            />
            {searchInput && (
              <button onClick={() => setSearchInput('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={12} />
              </button>
            )}
          </div>

          {/* Sort */}
          <select
            value={sort}
            onChange={(e) => updateParams((p) => p.set('sort', e.target.value))}
            className="input w-auto text-xs py-1.5"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => updateParams((p) => p.set('order', order === 'desc' ? 'asc' : 'desc'))}
            className="btn-ghost text-xs px-2"
            title={order === 'desc' ? 'Newest first' : 'Oldest first'}
          >
            {order === 'desc' ? '↓' : '↑'}
          </button>

          <button
            onClick={toggleSelectMode}
            className={`btn-ghost text-xs px-2.5 flex items-center gap-1 ${selectMode ? 'bg-brand/10 text-brand' : ''}`}
          >
            {selectMode ? <CheckSquare size={13} /> : <Square size={13} />}
            Select
          </button>

          {/* Grid size */}
          <div className="flex items-center gap-1 border border-slate-200 dark:border-white/[0.08] rounded-lg p-0.5">
            <LayoutGrid size={13} className="text-slate-400 ml-1.5" />
            {GRID_SIZES.map((s, i) => (
              <button
                key={s.label}
                onClick={() => { localStorage.setItem('gridSize', String(i)); updateParams((p) => p.set('grid', String(i))) }}
                className={`px-2 py-0.5 rounded-md text-xs font-medium transition-colors cursor-pointer
                  ${gridSizeIdx === i
                    ? 'bg-brand text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filter row: one pill per category */}
        {categories.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {categories.map((cat) => {
              const catTags = allTags.filter((t) => t.category_id === cat.id)
              if (!catTags.length) return null
              return (
                <CategoryFilter
                  key={cat.id}
                  cat={cat}
                  tags={catTags}
                  selectedTags={selectedTags}
                  onToggle={toggleTag}
                />
              )
            })}

            <button
              onClick={() => updateParams((p) => favorites ? p.delete('favorites') : p.set('favorites', '1'))}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                favorites
                  ? 'bg-yellow-400 border-yellow-400 text-white'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 hover:border-slate-300'
              }`}
            >
              <Star size={13} className={favorites ? 'fill-white text-white' : ''} />
              Favorites
            </button>

            {(selectedTags.size > 0 || favorites) && (
              <button
                onClick={clearFilters}
                className="btn-ghost text-xs gap-1 text-slate-400 hover:text-red-400"
              >
                <X size={11} /> Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className={`grid ${gridCols} gap-3`}>
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="card aspect-video animate-pulse" />
            ))}
          </div>
        ) : data.files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 dark:text-slate-500">
            <Search size={32} className="mb-3" />
            <p className="text-sm">No files found</p>
            {(selectedTags.size > 0 || search) && (
              <button onClick={clearFilters} className="btn-ghost mt-3 text-xs">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className={`grid ${gridCols} gap-3`}>
            {data.files.map((file) => (
              <MediaCard
                key={file.id}
                file={file}
                selectMode={selectMode}
                selected={selectedIds.has(file.id)}
                onSelect={() => setSelectedIds(prev => {
                  const next = new Set(prev)
                  next.has(file.id) ? next.delete(file.id) : next.add(file.id)
                  return next
                })}
                onFavoriteToggle={handleFavoriteToggle}
              />
            ))}
          </div>
        )}
      </div>

      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-52 right-0 z-30 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-white/[0.08] shadow-2xl">
          <div className="flex items-start gap-6 p-4 max-h-56 overflow-y-auto">
            <div className="flex-shrink-0 pt-0.5">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{selectedIds.size} selected</p>
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mt-0.5">Clear</button>
            </div>
            <div className="flex-1 space-y-2.5">
              {categories.map(cat => {
                const catTags = allTags.filter(t => t.category_id === cat.id)
                if (!catTags.length) return null
                const selFiles = data.files.filter(f => selectedIds.has(f.id))
                return (
                  <div key={cat.id}>
                    <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium mb-1.5">{cat.name}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {catTags.map(tag => {
                        const hasCount = selFiles.filter(f => f.tags.some(t => t.id === tag.id)).length
                        const allHave = hasCount === selFiles.length
                        return (
                          <button
                            key={tag.id}
                            onClick={() => handleBulkTag(tag.id, !allHave)}
                            className={`tag-btn ${allHave ? 'tag-btn-active' : ''}`}
                          >
                            {tag.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            <button onClick={() => { setSelectMode(false); setSelectedIds(new Set()) }} className="btn-primary flex-shrink-0">Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
