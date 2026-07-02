import React, { useState, useEffect, useCallback } from 'react'
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

  useEffect(() => {
    setLoading(true)
    getFile(id).then(setFile).finally(() => setLoading(false))
  }, [id])

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
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
          <div className="aspect-video bg-slate-200 dark:bg-slate-800 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!file) {
    return <div className="p-6 text-slate-400">File not found.</div>
  }

  return (
    <div className="p-6 h-screen flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-5 flex-shrink-0">
        <button onClick={() => navigate(-1)} className="btn-ghost -ml-1 self-start">
          <ArrowLeft size={14} /> Back
        </button>
        <button onClick={handleNext} disabled={nextLoading} className="btn-ghost disabled:opacity-40">
          Next <ArrowRight size={14} />
        </button>
      </div>

      <div className="flex gap-6 items-stretch flex-1 min-h-0">
        {/* Tag editor sidebar — full height, left of the main content */}
        <div className="w-72 flex-shrink-0">
          <div className="card p-4 h-full overflow-y-auto">
            <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-4">Tags</h3>
            <TagEditor file={file} onSaved={handleTagSaved} />
          </div>
        </div>

        {/* Main column: player (flexes to fill) + metadata (natural height) */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {file.file_type === 'video' ? (
            <div className="flex-1 min-h-0">
              <VideoPlayer file={file} />
            </div>
          ) : (
            <div className="flex-1 min-h-0 bg-slate-200 dark:bg-slate-800 rounded-xl flex items-center justify-center overflow-hidden">
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

          {/* File metadata */}
          <div className="mt-4 card p-4 flex-shrink-0">
            <div className="flex items-start justify-between gap-3 mb-3">
              {editingName ? (
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
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
                <div className="flex items-center gap-1.5 group flex-1 min-w-0">
                  <h2
                    className="font-medium text-slate-900 dark:text-slate-100 truncate cursor-pointer"
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
              {!editingName && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={async () => {
                      const updated = await patchFile(file.id, { is_favorite: file.is_favorite ? 0 : 1 })
                      setFile(updated)
                    }}
                    className="btn-ghost flex-shrink-0 flex items-center gap-1.5 text-xs"
                  >
                    <Star size={13} className={file.is_favorite ? 'fill-yellow-400 text-yellow-400' : ''} />
                    {file.is_favorite ? 'Favorited' : 'Favorite'}
                  </button>
                  <a
                    href={downloadUrl(file.id)}
                    download={file.filename}
                    className="btn-ghost flex-shrink-0 flex items-center gap-1.5 text-xs"
                  >
                    <Download size={13} /> Download
                  </a>
                </div>
              )}
            </div>
            {nameError && <p className="text-xs text-red-500 mb-3">{nameError}</p>}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {[
                ['Type', file.file_type],
                ['Dimensions', file.width ? `${file.width}×${file.height}` : '—'],
                ['Duration', file.duration ? `${file.duration.toFixed(2)}s` : '—'],
                ['Size', formatBytes(file.file_size) ?? '—'],
                ['FPS', file.fps ?? '—'],
                ['Aspect ratio', file.aspect_ratio ?? '—'],
                ['Added', file.date_added ? new Date(file.date_added).toLocaleDateString() : '—'],
              ].map(([label, val]) => (
                <div key={label} className="flex flex-col">
                  <dt className="text-xs text-slate-500 uppercase tracking-wider">{label}</dt>
                  <dd className="text-slate-600 dark:text-slate-300 font-mono text-xs mt-0.5">{val}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 pt-3 border-t border-slate-200 dark:border-white/[0.06]">
              <label className="text-xs text-slate-500 uppercase tracking-wider block mb-1.5">Notes</label>
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
                rows={3}
                className="input w-full text-sm resize-none"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
