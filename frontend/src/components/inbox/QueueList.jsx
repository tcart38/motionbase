import React, { useEffect, useRef } from 'react'
import { RiFilmLine, RiImageLine, RiSparklingLine } from '@remixicon/react'
import { Badge } from '@/components/ui/badge.jsx'
import { Skeleton } from '@/components/ui/skeleton.jsx'
import { Spinner } from '@/components/ui/spinner.jsx'
import { cn } from '@/lib/utils.js'
import { thumbnailUrl } from '@/api/client.js'
import { formatDuration } from '@/components/MediaCard.jsx'

/** The triage queue. The current file is highlighted and kept in view. */
export default function QueueList({ files, currentId, onSelect, loading, hasMore, loadingMore, onLoadMore }) {
  const currentRef = useRef(null)
  const sentinel = useRef(null)

  useEffect(() => { currentRef.current?.scrollIntoView({ block: 'nearest' }) }, [currentId])

  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && !loadingMore) onLoadMore() }, { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loadingMore, onLoadMore, files.length])

  if (loading) {
    return <div className="space-y-2 p-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
  }

  return (
    <ul className="space-y-1 p-2" aria-label="Files to review">
      {files.map((f) => {
        const thumb = thumbnailUrl(f)
        const ai = f.agent_reviewed_at
        const current = f.id === currentId
        return (
          <li key={f.id}>
            <button
              ref={current ? currentRef : undefined}
              type="button"
              aria-current={current ? 'true' : undefined}
              onClick={() => onSelect(f.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg p-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40',
                current && 'bg-primary/10 ring-1 ring-primary/40 hover:bg-primary/10'
              )}
            >
              <span className="relative block h-11 w-[4.5rem] shrink-0 overflow-hidden rounded-md bg-muted">
                {thumb ? (
                  <img src={thumb} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-muted-foreground">
                    {f.file_type === 'video' ? <RiFilmLine className="size-4" /> : <RiImageLine className="size-4" />}
                  </span>
                )}
                {f.duration ? (
                  <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 font-mono text-[0.5625rem] text-white">
                    {formatDuration(f.duration)}
                  </span>
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{f.filename}</span>
                <span className="mt-0.5 flex items-center gap-1">
                  {ai ? (
                    <Badge variant="secondary" className="text-primary"><RiSparklingLine /> Needs confirmation</Badge>
                  ) : (
                    <span className="text-[0.625rem] text-muted-foreground">
                      {f.tags?.some((t) => t.category_name !== 'Aspect Ratio') ? 'Tagged' : 'Untouched'}
                    </span>
                  )}
                </span>
              </span>
            </button>
          </li>
        )
      })}
      {hasMore && (
        <li ref={sentinel} className="flex justify-center py-2">{loadingMore ? <Spinner /> : null}</li>
      )}
    </ul>
  )
}
