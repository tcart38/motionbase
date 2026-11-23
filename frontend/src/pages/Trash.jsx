import React, { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RiDeleteBinLine, RiArrowGoBackLine, RiCloseLine, RiFilmLine } from '@remixicon/react'
import { Button } from '@/components/ui/button.jsx'
import { Checkbox } from '@/components/ui/checkbox.jsx'
import { Spinner } from '@/components/ui/spinner.jsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty.jsx'
import ConfirmAction from '@/components/ConfirmAction.jsx'
import { getFiles, purgeFiles, thumbnailUrl } from '@/api/client.js'
import { useAuth } from '@/context/AuthContext.jsx'
import { useBulkActions } from '@/hooks/useBulkActions.js'
import { formatDuration } from '@/components/MediaCard.jsx'

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

export default function Trash() {
  const qc = useQueryClient()
  const bulk = useBulkActions()
  const { isAdmin } = useAuth()
  const [selected, setSelected] = useState(() => new Set())
  const [confirm, setConfirm] = useState(null)

  const { data, isLoading } = useQuery({
    queryKey: ['files', 'trash'],
    queryFn: () => getFiles({ trash: '1', sort: 'date_added', order: 'desc', limit: 200 }),
  })
  const files = data?.files ?? []
  const total = data?.total ?? 0
  const chosen = useMemo(() => files.filter((f) => selected.has(f.id)), [files, selected])
  const targets = chosen.length ? chosen : files

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['files'] })
    qc.invalidateQueries({ queryKey: ['counts'] })
    qc.invalidateQueries({ queryKey: ['folders'] })
  }

  const restore = async () => {
    if (await bulk.restoreFiles(targets)) setSelected(new Set())
  }

  const purge = (list, all) => setConfirm({
    title: all ? 'Empty the Trash?' : `Permanently delete ${plural(list.length, 'file')}?`,
    description: 'This deletes the video files from the media folder and cannot be undone.',
    confirmLabel: 'Delete forever',
    onConfirm: async () => {
      try {
        const res = await purgeFiles(all ? { all: true } : { file_ids: list.map((f) => f.id) })
        if (res.purged) toast.success(`Permanently deleted ${plural(res.purged, 'file')}`)
        if (res.failed?.length) toast.error(`${plural(res.failed.length, 'file')} could not be deleted: ${res.failed[0].error}. They stay in the Trash.`)
        setSelected(new Set())
        refresh()
      } catch (err) { toast.error(err.message) }
    },
  })

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Trash</h1>
        <span className="text-xs text-muted-foreground">{plural(total, 'file')}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {selected.size > 0 && <Button variant="ghost" onClick={() => setSelected(new Set())}><RiCloseLine data-icon="inline-start" /> Clear selection</Button>}
          <Button variant="outline" disabled={!files.length} onClick={restore}>
            <RiArrowGoBackLine data-icon="inline-start" /> {chosen.length ? `Restore ${chosen.length}` : 'Restore all'}
          </Button>
          {isAdmin && <Button variant="destructive" disabled={!files.length} onClick={() => (chosen.length ? purge(chosen, false) : purge(files, true))}>
            <RiDeleteBinLine data-icon="inline-start" /> {chosen.length ? `Delete ${chosen.length} forever` : 'Empty Trash'}
          </Button>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Deleted videos stay on disk and are hidden everywhere else (including from AI agents) until you restore them{isAdmin ? ' or delete them forever' : ' (only an administrator can delete forever)'}.
      </p>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center"><Spinner /></div>
      ) : files.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><RiDeleteBinLine /></EmptyMedia>
            <EmptyTitle>Trash is empty</EmptyTitle>
            <EmptyDescription>Deleted videos show up here so you can restore them.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] content-start gap-3 overflow-y-auto">
          {files.map((f) => {
            const thumb = thumbnailUrl(f)
            return (
              <li key={f.id} className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                <label className="relative block aspect-video cursor-pointer bg-muted">
                  {thumb ? <img src={thumb} alt="" loading="lazy" className="size-full object-cover opacity-80" /> : <RiFilmLine className="absolute inset-0 m-auto size-6 text-muted-foreground" />}
                  <Checkbox className="absolute left-2 top-2" checked={selected.has(f.id)} onCheckedChange={() => toggle(f.id)} aria-label={`Select ${f.filename}`} />
                  {f.duration ? <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1 text-[10px] text-white">{formatDuration(f.duration)}</span> : null}
                </label>
                <div className="flex items-center gap-1 p-2">
                  <span className="min-w-0 flex-1 truncate text-xs" title={f.filename}>{f.filename}</span>
                  <Button size="icon-sm" variant="ghost" aria-label={`Restore ${f.filename}`} title="Restore" onClick={() => bulk.restoreFiles([f])}><RiArrowGoBackLine /></Button>
                  {isAdmin && <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={`Delete ${f.filename} forever`} title="Delete forever" onClick={() => purge([f], false)}><RiDeleteBinLine /></Button>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmAction request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}
