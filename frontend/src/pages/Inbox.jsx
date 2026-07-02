import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Check, ChevronRight, Download, Upload, X } from 'lucide-react'
import { getFiles, patchFile, getTags, getCategories } from '../api/client.js'
import { useNavigate } from 'react-router-dom'
import { thumbnailUrl } from '../api/client.js'

function formatDuration(secs) {
  if (!secs) return null
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function InlineTagPicker({ file, categories, allTags, onSaved }) {
  const [selectedIds, setSelectedIds] = useState(new Set(file.tags.map((t) => t.id)))
  const [saving, setSaving] = useState(false)

  const toggle = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await patchFile(file.id, { tag_ids: [...selectedIds], needs_tagging: 0 })
      onSaved(updated)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 space-y-3">
      {categories.map((cat) => {
        const catTags = allTags.filter((t) => t.category_id === cat.id)
        if (!catTags.length) return null
        return (
          <div key={cat.id}>
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium mb-1.5">{cat.name}</p>
            <div className="flex flex-wrap gap-1.5">
              {catTags.map((tag) => {
                const active = selectedIds.has(tag.id)
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggle(tag.id)}
                    className={`tag-btn ${active ? 'tag-btn-active' : ''}`}
                  >
                    {tag.name}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-primary mt-1 disabled:opacity-50"
      >
        <Check size={14} />
        {saving ? 'Saving…' : 'Done'}
      </button>
    </div>
  )
}

let _uploadIdCounter = 0

function FileUpload({ onUploaded }) {
  const [items, setItems] = useState([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const uploadFile = useCallback((id, file) => {
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, status: 'uploading' } : it))

    const form = new FormData()
    form.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100)
        setItems((prev) => prev.map((it) => it.id === id ? { ...it, progress: pct } : it))
      }
    }
    xhr.onload = () => {
      if (xhr.status === 200) {
        setItems((prev) => prev.map((it) => it.id === id ? { ...it, status: 'done', progress: 100 } : it))
        onUploaded()
      } else {
        setItems((prev) => prev.map((it) => it.id === id ? { ...it, status: 'error' } : it))
      }
    }
    xhr.onerror = () => {
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, status: 'error' } : it))
    }
    xhr.open('POST', '/api/upload')
    xhr.send(form)
  }, [onUploaded])

  const addFiles = useCallback((fileList) => {
    const newItems = [...fileList].map((file) => {
      const id = ++_uploadIdCounter
      return { id, file, status: 'pending', progress: 0 }
    })
    setItems((prev) => [...prev, ...newItems])
    newItems.forEach(({ id, file }) => uploadFile(id, file))
  }, [uploadFile])

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  const dismiss = (id) => setItems((prev) => prev.filter((it) => it.id !== id))

  return (
    <div className="card p-4 mb-6">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">Upload files</p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
        onDrop={handleDrop}
        onClick={() => inputRef.current.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors select-none ${
          dragging
            ? 'border-brand bg-brand/5 dark:bg-brand/10'
            : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
        }`}
      >
        <Upload size={22} className="mx-auto mb-2 text-slate-400" />
        <p className="text-sm text-slate-500 dark:text-slate-400">Drop files here or <span className="text-brand font-medium">click to browse</span></p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">MP4, MOV, MKV, WebM, AVI · JPG, PNG, GIF, WebP</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,video/x-m4v,image/jpeg,image/png,image/gif,image/webp,image/bmp"
        className="hidden"
        onChange={(e) => { if (e.target.files.length) addFiles(e.target.files); e.target.value = '' }}
      />

      {items.length > 0 && (
        <div className="mt-3 space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-700 dark:text-slate-300 truncate mb-1">{item.file.name}</p>
                <div className="h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${item.status === 'error' ? 'bg-red-500' : 'bg-brand'}`}
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              </div>
              <span className="text-xs w-8 text-right flex-shrink-0 font-mono text-slate-500 dark:text-slate-400">
                {item.status === 'done' ? <Check size={13} className="text-green-500 ml-auto" /> : item.status === 'error' ? <span className="text-red-500">err</span> : `${item.progress}%`}
              </span>
              {(item.status === 'done' || item.status === 'error') && (
                <button onClick={() => dismiss(item.id)} className="btn-ghost p-0.5 flex-shrink-0">
                  <X size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const PROGRESS_RE = /^\[download\]\s+[\d.]+%/

function UrlImport({ onImported }) {
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [logs, setLogs] = useState([])
  const [error, setError] = useState(null)
  const logsEndRef = useRef(null)

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [logs])

  const handleImport = async () => {
    const trimmed = url.trim()
    if (!trimmed) return
    setImporting(true)
    setError(null)
    setLogs([])

    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        setError(err.error || 'Import failed')
        setImporting(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            if (msg.type === 'log') {
              setLogs((prev) => {
                // Keep progress lines updating in place instead of flooding the log
                if (PROGRESS_RE.test(msg.line) && prev.length && PROGRESS_RE.test(prev[prev.length - 1])) {
                  return [...prev.slice(0, -1), msg.line]
                }
                return [...prev, msg.line]
              })
            } else if (msg.type === 'done') {
              setUrl('')
              onImported()
            } else if (msg.type === 'error') {
              setError(msg.message)
            }
          } catch {}
        }
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="card p-4 mb-6">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-3">Import from URL</p>
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !importing && handleImport()}
          placeholder="https://www.linkedin.com/posts/… or YouTube URL"
          className="input flex-1 text-sm"
          disabled={importing}
        />
        <button
          onClick={handleImport}
          disabled={!url.trim() || importing}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download size={14} />
          {importing ? 'Downloading…' : 'Import'}
        </button>
      </div>
      {logs.length > 0 && (
        <div className="mt-3 bg-slate-950 rounded-lg p-3 h-36 overflow-y-auto font-mono text-xs text-slate-300 space-y-0.5">
          {logs.map((line, i) => (
            <div key={i} className={PROGRESS_RE.test(line) ? 'text-brand' : ''}>{line}</div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  )
}

export default function Inbox() {
  const [files, setFiles] = useState([])
  const [categories, setCategories] = useState([])
  const [allTags, setAllTags] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    const [result, cats, tags] = await Promise.all([
      getFiles({ view: 'inbox', sort: 'date_added', order: 'desc', limit: 200 }),
      getCategories(),
      getTags(),
    ])
    setFiles(result.files)
    setCategories(cats)
    setAllTags(tags)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSaved = useCallback((updated) => {
    setFiles((prev) => prev.filter((f) => f.id !== updated.id))
    setExpandedId(null)
  }, [])

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card h-16 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Add Media</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Import from URL or tag files waiting below</p>
      </div>

      <div className="max-w-2xl">
        <FileUpload onUploaded={load} />
        <UrlImport onImported={load} />

        {!loading && files.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500">
            <Check size={32} className="mb-3 text-green-500" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">All files tagged</p>
          </div>
        )}

      <div className="space-y-2">
        {files.map((file) => {
          const thumb = thumbnailUrl(file)
          const expanded = expandedId === file.id
          return (
            <div key={file.id} className={`card transition-all duration-150 ${expanded ? 'ring-1 ring-brand/30' : ''}`}>
              <div
                className="flex items-center gap-3 p-3 cursor-pointer"
                onClick={() => setExpandedId(expanded ? null : file.id)}
              >
                {/* Thumbnail */}
                <div className="w-20 h-12 flex-shrink-0 bg-slate-200 dark:bg-slate-700 rounded-lg overflow-hidden">
                  {thumb ? (
                    <img src={thumb} alt={file.filename} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs">
                      {file.file_type}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 dark:text-slate-200 font-medium truncate">{file.filename}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {file.file_type} {formatDuration(file.duration) ? `· ${formatDuration(file.duration)}` : ''}
                    {file.width ? ` · ${file.width}×${file.height}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/player/${file.id}`) }}
                    className="btn-ghost text-xs py-1"
                  >
                    Open
                  </button>
                  <ChevronRight
                    size={14}
                    className={`text-slate-500 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
                  />
                </div>
              </div>

              {expanded && (
                <div className="px-3 pb-3 border-t border-white/[0.06] pt-3">
                  <InlineTagPicker
                    file={file}
                    categories={categories}
                    allTags={allTags}
                    onSaved={handleSaved}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
      </div>
    </div>
  )
}
