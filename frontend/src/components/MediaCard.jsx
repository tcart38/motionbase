import React, { memo, useCallback, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  RiPlayFill, RiImageLine, RiFilmLine, RiStarLine, RiStarFill, RiSparklingLine, RiExternalLinkLine,
  RiFolderTransferLine, RiDeleteBinLine, RiCheckDoubleLine,
} from '@remixicon/react'
import { Badge } from '@/components/ui/badge.jsx'
import { Checkbox } from '@/components/ui/checkbox.jsx'
import { Button } from '@/components/ui/button.jsx'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu.jsx'
import { cn } from '@/lib/utils.js'
import { thumbnailUrl, streamUrl } from '@/api/client.js'

export function formatDuration(secs) {
  if (!secs) return null
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const isNewFile = (file) => file.date_added && (Date.now() - new Date(file.date_added.replace(' ', 'T') + 'Z').getTime()) / 864e5 <= 7

/**
 * One library tile. An <article> whose controls (select, favorite, play) are siblings of the
 * link to the player, so there are no nested interactive elements.
 * - Click opens the player; in selection mode (or with Ctrl/Cmd/Shift) it selects instead.
 * - Hovering a video scrubs it with the mouse position.
 */
function MediaCard({
  file, selectMode, selected, onSelect, onFavoriteToggle, onPlay, onDragStartFiles, onMove, onMarkReviewed, onDelete,
}) {
  const location = useLocation()
  const videoRef = useRef(null)
  const latestPctRef = useRef(0)
  const [hovering, setHovering] = useState(false)
  const [scrubPct, setScrubPct] = useState(0)

  const thumb = thumbnailUrl(file)
  const duration = formatDuration(file.duration)
  const scrubbable = file.file_type === 'video' && !!file.duration
  const aiTagged = file.tags?.some((t) => t.source === 'agent')
  const visibleTags = (file.tags ?? []).filter((t) => t.category_name !== 'Aspect Ratio')
  const to = `/player/${file.id}${location.search}`

  const onMouseMove = useCallback((e) => {
    if (!scrubbable) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    latestPctRef.current = pct
    setScrubPct(pct)
    const v = videoRef.current
    if (v && v.readyState >= 1) v.currentTime = pct * file.duration
  }, [scrubbable, file.duration])

  const onLinkClick = (e) => {
    if (selectMode || e.shiftKey || e.metaKey || e.ctrlKey) {
      e.preventDefault()
      onSelect(file, { shift: e.shiftKey })
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <article
            draggable
            onDragStart={(e) => onDragStartFiles(e, file)}
            aria-label={file.filename}
            data-selected={selected || undefined}
            className={cn(
              'group/card relative overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10 transition-shadow',
              'hover:ring-foreground/25 focus-within:ring-2 focus-within:ring-ring/50',
              selected && 'ring-2 ring-primary'
            )}
          />
        }
      >
        <div
          className="relative aspect-video overflow-hidden bg-muted"
          onMouseEnter={() => { if (scrubbable) { latestPctRef.current = 0; setHovering(true) } }}
          onMouseLeave={() => { setHovering(false); setScrubPct(0) }}
          onMouseMove={onMouseMove}
        >
          {thumb ? (
            <img
              src={thumb}
              alt=""
              loading="lazy"
              draggable={false}
              className={cn('size-full object-cover transition-opacity', hovering && 'opacity-0')}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              {file.file_type === 'video' ? <RiFilmLine className="size-8" /> : <RiImageLine className="size-8" />}
            </div>
          )}

          {hovering && scrubbable && (
            <video
              ref={videoRef}
              src={streamUrl(file.id)}
              className="absolute inset-0 size-full object-cover"
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={() => { if (videoRef.current) videoRef.current.currentTime = latestPctRef.current * file.duration }}
            />
          )}
          {hovering && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-black/30">
              <div className="h-full bg-primary" style={{ width: `${scrubPct * 100}%` }} />
            </div>
          )}

          {/* Stretched link to the player */}
          <Link
            to={to}
            onClick={onLinkClick}
            draggable={false}
            aria-label={`${selectMode ? 'Select' : 'Open'} ${file.filename}`}
            className="absolute inset-0 z-10 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />

          {/* Overlay controls: siblings of the link, above it */}
          <div className={cn(
            'absolute left-1.5 top-1.5 z-20 flex items-center gap-1',
            !selectMode && !selected && 'opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100'
          )}>
            <Checkbox
              checked={!!selected}
              onCheckedChange={() => onSelect(file, { shift: false })}
              onClick={(e) => { if (e.shiftKey) { e.preventDefault(); onSelect(file, { shift: true }) } }}
              aria-label={`Select ${file.filename}`}
              className="bg-background/80 backdrop-blur-sm"
            />
          </div>
          {isNewFile(file) && !selectMode && !selected && (
            <Badge className="pointer-events-none absolute left-1.5 top-1.5 z-20 group-hover/card:hidden group-focus-within/card:hidden">New</Badge>
          )}

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onFavoriteToggle(file)}
            aria-label={file.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={!!file.is_favorite}
            className={cn(
              'absolute right-1.5 top-1.5 z-20 rounded-full bg-black/45 text-white hover:bg-black/65 hover:text-white',
              !file.is_favorite && 'opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100'
            )}
          >
            {file.is_favorite ? <RiStarFill className="text-amber-400" /> : <RiStarLine />}
          </Button>

          {!selectMode && file.file_type === 'video' && onPlay && (
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={() => onPlay(file)}
              aria-label={`Play ${file.filename} in place`}
              className="absolute inset-0 z-20 m-auto rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/75 hover:text-white group-hover/card:opacity-100 focus-visible:opacity-100"
            >
              <RiPlayFill />
            </Button>
          )}

          {duration && (
            <span className="pointer-events-none absolute bottom-1.5 right-1.5 z-20 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[0.625rem] text-white">
              {duration}
            </span>
          )}

          {file.is_missing ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/60">
              <span className="text-xs font-medium text-red-300">Missing</span>
            </div>
          ) : null}
        </div>

        <div className="space-y-1.5 p-2.5">
          <p className="truncate text-xs font-medium" title={file.filename}>{file.filename}</p>
          {(visibleTags.length > 0 || aiTagged) && (
            <div className="flex flex-wrap gap-1">
              {aiTagged && (
                <Badge variant="secondary" title="Tagged by an AI agent" className="text-primary">
                  <RiSparklingLine /> AI
                </Badge>
              )}
              {visibleTags.slice(0, 3).map((t) => (
                <Badge key={t.id} variant={t.source === 'agent' ? 'outline' : 'secondary'}>{t.name}</Badge>
              ))}
              {visibleTags.length > 3 && <Badge variant="ghost" className="text-muted-foreground">+{visibleTags.length - 3}</Badge>}
            </div>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem render={<Link to={to} />}><RiExternalLinkLine /> Open</ContextMenuItem>
        {file.file_type === 'video' && onPlay && (
          <ContextMenuItem onClick={() => onPlay(file)}><RiPlayFill /> Play here</ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => onFavoriteToggle(file)}>
          {file.is_favorite ? <RiStarLine /> : <RiStarFill />} {file.is_favorite ? 'Remove favorite' : 'Favorite'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onMove(file)}><RiFolderTransferLine /> Move to folder…</ContextMenuItem>
        {!file.reviewed_at && (
          <ContextMenuItem onClick={() => onMarkReviewed(file)}><RiCheckDoubleLine /> Mark reviewed</ContextMenuItem>
        )}
      <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => onDelete?.(file)}><RiDeleteBinLine /> Move to Trash</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export default memo(MediaCard)
