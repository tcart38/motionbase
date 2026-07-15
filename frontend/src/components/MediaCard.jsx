import React, { useRef, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Play, Image, Star, Check } from 'lucide-react'
import TagChip from './TagChip.jsx'
import { thumbnailUrl, streamUrl } from '../api/client.js'

function formatDuration(secs) {
  if (!secs) return null
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function MediaCard({ file, selectMode, selected, onSelect, onFavoriteToggle, onPlay }) {
  const navigate = useNavigate()
  const location = useLocation()
  const videoRef = useRef(null)
  // latestPct tracks the mouse position so we can seek after metadata loads
  const latestPctRef = useRef(0)
  const [isHovering, setIsHovering] = useState(false)
  const [scrubPct, setScrubPct] = useState(0)

  const thumb = thumbnailUrl(file)
  const duration = formatDuration(file.duration)
  const isScrubbable = file.file_type === 'video' && !!file.duration

  const isNew = (() => {
    if (!file.date_added) return false
    const added = new Date(file.date_added)
    const now = new Date()
    return (now - added) / (1000 * 60 * 60 * 24) <= 7
  })()

  const handleMouseEnter = useCallback(() => {
    if (!isScrubbable) return
    latestPctRef.current = 0
    setIsHovering(true)
  }, [isScrubbable])

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false)
    setScrubPct(0)
  }, [])

  const handleMouseMove = useCallback((e) => {
    if (!isScrubbable) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    latestPctRef.current = pct
    setScrubPct(pct)
    const v = videoRef.current
    // Only seek if metadata is already loaded (readyState 1 = HAVE_METADATA)
    if (v && v.readyState >= 1) {
      v.currentTime = pct * file.duration
    }
  }, [isScrubbable, file.duration])

  // Called when the hover-video's metadata loads — apply the latest mouse position
  const handleVideoMetadata = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = latestPctRef.current * file.duration
  }, [file.duration])

  return (
    <button
      onClick={() => selectMode ? onSelect() : navigate(`/player/${file.id}${location.search}`)}
      className="card group text-left w-full overflow-hidden transition-all duration-150
                 hover:border-white/[0.12] hover:ring-1 hover:ring-brand/30
                 focus:outline-none focus:ring-2 focus:ring-brand/50 cursor-pointer"
    >
      {/* Thumbnail area */}
      <div
        className="relative aspect-video bg-slate-200 dark:bg-slate-700 overflow-hidden"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
      >
        {/* Static thumbnail — hidden while scrubbing */}
        {thumb ? (
          <img
            src={thumb}
            alt={file.filename}
            className={`w-full h-full object-cover transition-opacity duration-100
              ${isHovering ? 'opacity-0' : 'opacity-100'}`}
            loading="lazy"
          />
        ) : (
          <div className={`w-full h-full flex items-center justify-center
            text-slate-400 dark:text-slate-500 transition-opacity duration-100
            ${isHovering ? 'opacity-0' : 'opacity-100'}`}>
            {file.file_type === 'video' ? <Play size={32} /> : <Image size={32} />}
          </div>
        )}

        {/* Hover-scrub video — only mounted while hovering so preload="metadata"
            only fires one request at a time, not for every card on the page */}
        {isHovering && isScrubbable && (
          <video
            ref={videoRef}
            src={streamUrl(file.id)}
            className="absolute inset-0 w-full h-full object-cover"
            muted
            preload="metadata"
            playsInline
            onLoadedMetadata={handleVideoMetadata}
          />
        )}

        {/* Scrub progress bar */}
        {isHovering && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/30 pointer-events-none">
            <div
              className="h-full bg-brand"
              style={{ width: `${scrubPct * 100}%`, transition: 'none' }}
            />
          </div>
        )}

        {/* Play in place — opens the file in a modal without leaving the library */}
        {!selectMode && file.file_type === 'video' && onPlay && (
          <button
            onClick={(e) => { e.stopPropagation(); onPlay(file) }}
            className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-black/50 flex items-center justify-center
              opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70 hover:scale-110 duration-150"
            title="Play"
            aria-label="Play"
          >
            <Play size={16} className="text-white fill-white ml-0.5" />
          </button>
        )}

        {isNew && !selectMode && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-brand text-white text-[10px] font-semibold leading-none">New</span>
        )}

        {selectMode && (
          <div className={`absolute top-1.5 left-1.5 w-5 h-5 rounded border-2 flex items-center justify-center ${selected ? 'bg-brand border-brand' : 'bg-black/30 border-white/70'}`}>
            {selected && <Check size={11} className="text-white" />}
          </div>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); onFavoriteToggle(file.id, !file.is_favorite) }}
          className={`absolute top-1.5 right-1.5 p-1 rounded-full bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity ${file.is_favorite ? '!opacity-100' : ''}`}
        >
          <Star size={12} className={file.is_favorite ? 'text-yellow-400 fill-yellow-400' : 'text-white'} />
        </button>

        {/* Duration badge */}
        {duration && (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70
                           text-white text-xs font-mono">
            {duration}
          </span>
        )}

        {file.is_missing && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-xs text-red-400 font-medium">Missing</span>
          </div>
        )}
      </div>

      {/* File info */}
      <div className="p-2.5">
        <p className="text-xs text-slate-700 dark:text-slate-300 font-medium truncate mb-1.5"
           title={file.filename}>
          {file.filename}
        </p>
        {file.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {file.tags.slice(0, 4).map((t) => (
              <TagChip key={t.id} tag={t} />
            ))}
            {file.tags.length > 4 && (
              <span className="tag-chip text-slate-400 dark:text-slate-500">
                +{file.tags.length - 4}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  )
}
