import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Download, Image as ImageIcon, Pencil, Star, X } from 'lucide-react'
import { getFile, getNextFile, patchFile, streamUrl, thumbnailUrl, downloadUrl } from '../api/client.js'
import VideoPlayer from '../components/VideoPlayer.jsx'
import TagEditor from '../components/TagEditor.jsx'

function formatBytes(bytes) {
  if (!bytes) return null
  const units = ['B', 'KB', 'MB', 'GB']
  let val = bytes
  let i = 0
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
  return `${val.toFixed(i === 0 || val >= 10 ? 0 : 1)} ${units[i]}`
}

export default function Player() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [nextLoading, setNextLoading] = useState(false)
  const [saveState, setSaveState] = useState('idle') // tag save status, shown in panel header

  useEffect(() => {
    setLoading(true)
    getFile(id).then(setFile).finally(() => setLoading(false))
  }, [id])

  // Left panel: switch between Tags and Notes; always reset to Tags on a new video.
  const [sidebarTab, setSidebarTab] = useState('tags')
  useEffect(() => { setSidebarTab('tags') }, [id])

  // Left panel is resizable; the chosen width sticks for the session.
  const MIN_W = 220
  const MAX_W = 520
  const asideRef = useRef(null)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = parseInt(sessionStorage.getItem('player:tagsWidth'), 10)
    return Number.isInteger(saved) ? Math.max(MIN_W, Math.min(MAX_W, saved)) : 288
  })
  const widthRef = useRef(sidebarWidth)
  useEffect(() => { widthRef.current = sidebarWidth }, [sidebarWidth])
  const resizingRef = useRef(false)

  const startResize = useCallback((e) => {
    e.preventDefault()
    resizingRef.current = true
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }, [])

  useEffect(() => {
    const onMove = (e) => {
      if (!resizingRef.current || !asideRef.current) return
      const left = asideRef.current.getBoundingClientRect().left
      setSidebarWidth(Math.max(MIN_W, Math.min(MAX_W, e.clientX - left)))
    }
    const onUp = () => {
      if (!resizingRef.current) return
      resizingRef.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      sessionStorage.setItem('player:tagsWidth', String(widthRef.current))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  const handleNext = useCallback(async () => {
    setNextLoading(true)
    try {
      const { nextId } = await getNextFile(id, Object.fromEntries(searchParams))
      navigate(`/player/${nextId}?${searchParams.toString()}`)
    } catch {
      // No files match the current filter — nothing to advance to.
    } finally {
      setNextLoading(false)
    }
  }, [id, searchParams, navigate])

  const handleTagSaved = useCallback((updated) => setFile(updated), [])

  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState(null)
  const [notesValue, setNotesValue] = useState(file?.notes || '')

  useEffect(() => { setNotesValue(file?.notes || '') }, [file?.notes])

  const ext = file?.filename.includes('.') ? file.filename.slice(file.filename.lastIndexOf('.')) : ''
  const baseName = file ? (ext ? file.filename.slice(0, -ext.length) : file.filename) : ''

  const startEditName = () => { setDraftName(baseName); setNameError(null); setEditingName(true) }
  const cancelEditName = () => { setEditingName(false); setNameError(null) }
  const saveEditName = useCallback(async () => {
    const trimmed = draftName.trim()
    if (!trimmed || trimmed === baseName) { cancelEditName(); return }
    setNameSaving(true)
    setNameError(null)
    try {
      const updated = await patchFile(file.id, { filename: trimmed + ext })
      setFile(updated)
      setEditingName(false)
    } catch (err) {
      setNameError(err.message)
    } finally {
      setNameSaving(false)
    }
  }, [draftName, baseName, ext, file])

  if (loading) {
    return (
      <div className="h-full flex">
        <div className="w-72 flex-shrink-0 border-r border-slate-200 dark:border-white/[0.06] p-4">
          <div className="animate-pulse space-y-3">
            <div className="h-5 w-20 bg-slate-200 dark:bg-slate-800 rounded" />
            <div className="h-24 bg-slate-200 dark:bg-slate-800 rounded" />
          </div>
        </div>
        <div className="flex-1 p-6">
          <div className="animate-pulse aspect-video bg-slate-200 dark:bg-slate-800 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!file) {
    return <div className="p-6 text-slate-400">File not found.</div>
  }

  const metadata = [
    ['Type', file.file_type],
    ['Dimensions', file.width ? `${file.width}×${file.height}` : '—'],
    ['Duration', file.duration ? `${file.duration.toFixed(2)}s` : '—'],
    ['Size', formatBytes(file.file_size) ?? '—'],
    ['FPS', file.fps ?? '—'],
    ['Aspect ratio', file.aspect_ratio ?? '—'],
    ['Added', file.date_added ? new Date(file.date_added).toLocaleDateString() : '—'],
  ]

  return (
    // Fills the main content area exactly; nothing here scrolls the whole page.
    <div className="h-full flex overflow-hidden">
      {/* Tags/Notes — a panel flush against the nav sidebar, not a floating card */}
      <aside
        ref={asideRef}
        style={{ width: `${sidebarWidth}px` }}
        className="relative flex-shrink-0 flex flex-col
                   border-r border-slate-200 dark:border-white/[0.06]
                   bg-white dark:bg-slate-900">
        {/* Tab header */}
        <div className="flex items-center justify-between pl-2 pr-3 h-14 flex-shrink-0
                        border-b border-slate-200 dark:border-white/[0.06]">
          <div className="flex items-center gap-1">
            {['tags', 'notes'].map((t) => (
              <button
                key={t}
                onClick={() => setSidebarTab(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                  sidebarTab === t
                    ? 'bg-brand/10 text-brand'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {sidebarTab === 'tags' && saveState === 'saving' && (
            <span className="text-xs text-slate-400 dark:text-slate-500">Saving…</span>
          )}
          {sidebarTab === 'tags' && saveState === 'saved' && (
            <span className="text-xs text-emerald-500 flex items-center gap-1">
              <Check size={11} /> Saved
            </span>
          )}
        </div>

        {/* Panel body */}
        <div className="flex-1 min-h-0">
          {sidebarTab === 'tags' ? (
            <div className="h-full overflow-y-auto px-4 py-4">
              <TagEditor file={file} onSaved={handleTagSaved} onSaveStateChange={setSaveState} />
            </div>
          ) : (
            <div className="h-full p-4">
              <textarea
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                onBlur={async () => {
                  if (notesValue !== (file.notes || '')) {
                    const updated = await patchFile(file.id, { notes: notesValue })
                    setFile(updated)
                  }
                }}
                placeholder="Add a note…"
                className="input w-full h-full text-sm resize-none leading-relaxed"
              />
            </div>
          )}
        </div>

        {/* Drag handle straddling the right border to resize the panel */}
        <div
          onMouseDown={startResize}
          title="Drag to resize"
          className="absolute inset-y-0 right-0 w-2 translate-x-1/2 cursor-col-resize z-20 group/resize"
        >
          <div className="mx-auto h-full w-px group-hover/resize:bg-brand transition-colors" />
        </div>
      </aside>

      {/* Main column: top bar + player + info, all sized to fit the viewport */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Top bar: nav + filename + actions */}
        <header className="flex items-center gap-3 px-4 h-14 flex-shrink-0
                          border-b border-slate-200 dark:border-white/[0.06]">
          <button onClick={() => navigate(`/library?${searchParams.toString()}`)} className="btn-ghost -ml-1 flex-shrink-0">
            <ArrowLeft size={14} /> Back
          </button>

          {/* Editable filename — centered, grows to fill */}
          <div className="flex-1 min-w-0 flex justify-center">
            {editingName ? (
              <div className="flex items-center gap-1.5 w-full max-w-lg">
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEditName(); if (e.key === 'Escape') cancelEditName() }}
                  className="input py-1 text-sm flex-1 min-w-0"
                  disabled={nameSaving}
                />
                {ext && <span className="text-slate-400 dark:text-slate-500 text-sm flex-shrink-0">{ext}</span>}
                <button onClick={saveEditName} disabled={nameSaving} className="btn-ghost p-1 flex-shrink-0"><Check size={13} /></button>
                <button onClick={cancelEditName} className="btn-ghost p-1 flex-shrink-0"><X size={13} /></button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 group min-w-0 max-w-lg">
                <h2
                  className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate cursor-pointer"
                  title={file.filename}
                  onClick={startEditName}
                >
                  {file.filename}
                </h2>
                <button onClick={startEditName} className="btn-ghost p-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <Pencil size={11} />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={async () => {
                const updated = await patchFile(file.id, { is_favorite: file.is_favorite ? 0 : 1 })
                setFile(updated)
              }}
              className="btn-ghost flex items-center gap-1.5 text-xs"
            >
              <Star size={13} className={file.is_favorite ? 'fill-yellow-400 text-yellow-400' : ''} />
              <span className="hidden sm:inline">{file.is_favorite ? 'Favorited' : 'Favorite'}</span>
            </button>
            <a
              href={downloadUrl(file.id)}
              download={file.filename}
              className="btn-ghost flex items-center gap-1.5 text-xs"
            >
              <Download size={13} /> <span className="hidden sm:inline">Download</span>
            </a>
            <button onClick={handleNext} disabled={nextLoading} className="btn-ghost disabled:opacity-40">
              Next <ArrowRight size={14} />
            </button>
          </div>
        </header>
        {nameError && <p className="px-4 pt-2 text-xs text-red-500 flex-shrink-0">{nameError}</p>}

        {/* Player — flexes to fill all remaining space above the info bar */}
        <div className="flex-1 min-h-0 p-4">
          {file.file_type === 'video' ? (
            <VideoPlayer file={file} />
          ) : (
            <div className="h-full bg-slate-200 dark:bg-slate-800 rounded-xl flex items-center justify-center overflow-hidden">
              {thumbnailUrl(file) ? (
                <img
                  src={streamUrl(file.id)}
                  alt={file.filename}
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div className="py-20 text-slate-400 dark:text-slate-500 flex flex-col items-center gap-2">
                  <ImageIcon size={32} />
                  <span className="text-sm">No preview</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Info bar — metadata only; capped with its own scroll so it never crowds the player */}
        <div className="flex-shrink-0 border-t border-slate-200 dark:border-white/[0.06]
                        max-h-32 overflow-y-auto px-4 py-3">
          <dl className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-x-4 gap-y-2 text-sm">
            {metadata.map(([label, val]) => (
              <div key={label} className="flex flex-col min-w-0">
                <dt className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</dt>
                <dd className="text-slate-600 dark:text-slate-300 font-mono text-xs mt-0.5 truncate">{val}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  )
}
