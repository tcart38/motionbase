import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RiAddLine, RiCheckLine, RiCloseLine, RiSparklingLine, RiLockLine } from '@remixicon/react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge.jsx'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.jsx'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command.jsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.jsx'
import { Skeleton } from '@/components/ui/skeleton.jsx'
import { cn } from '@/lib/utils.js'
import { patchFile, createTag, createCategory } from '@/api/client.js'
import { useTaxonomy } from '@/hooks/useTaxonomy.js'

// Once a category has more tags than this, only the most-used ones show inline and the rest
// live behind a searchable "+N more" popover.
const COLLAPSE_AFTER = 10
const VISIBLE_COUNT = 8

function TagToggle({ tag, active, aiSourced, disabled, onToggle, hotkey }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={() => onToggle(tag.id)}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-xs outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60',
        active
          ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
          : 'border-input bg-transparent hover:bg-muted'
      )}
    >
      {aiSourced && active && <RiSparklingLine className="size-3" aria-label="Added by AI" />}
      {tag.name}
      {hotkey && <kbd className="ml-0.5 font-mono text-[0.625rem] opacity-60">{hotkey}</kbd>}
    </button>
  )
}

function MoreTags({ cat, tags, selectedIds, onToggle }) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" />}>
        +{tags.length} more
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0">
        <Command>
          <CommandInput placeholder={`Search ${cat.name.toLowerCase()}…`} />
          <CommandList className="max-h-60">
            <CommandEmpty>No matching tags.</CommandEmpty>
            {tags.map((t) => (
              <CommandItem key={t.id} value={t.name} data-checked={selectedIds.has(t.id)} onSelect={() => onToggle(t.id)}>
                {t.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function InlineAdd({ placeholder, onSubmit, label }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    const v = value.trim()
    if (!v) return
    setBusy(true)
    try { await onSubmit(v); setValue(''); setOpen(false) } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" onClick={() => setOpen(true)}>
        <RiAddLine data-icon="inline-start" /> {label}
      </Button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') { setOpen(false); setValue('') }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-6 w-32"
        disabled={busy}
      />
      <Button size="icon-sm" variant="ghost" onClick={submit} disabled={busy} aria-label="Save"><RiCheckLine /></Button>
      <Button size="icon-sm" variant="ghost" onClick={() => { setOpen(false); setValue('') }} aria-label="Cancel"><RiCloseLine /></Button>
    </span>
  )
}

/**
 * Tag editor for one file. Changes autosave 600 ms after the last toggle.
 * Categories with selection "single" behave like radio groups; system categories are read-only.
 * `toggleRef` receives the toggle function so a parent can bind keyboard shortcuts.
 * `hotkeys` (Map tagId -> key label) shows a key hint on a tag; the caller binds the keys (Inbox triage).
 */
export default function TagEditor({ file, onSaved, onSaveStateChange, showNewCategory = true, hotkeys, toggleRef }) {
  const { groups, isLoading } = useTaxonomy()
  const qc = useQueryClient()
  const [selectedIds, setSelectedIds] = useState(() => new Set((file?.tags ?? []).map((t) => t.id)))
  const [saveState, setSaveState] = useState('idle')

  const timer = useRef(null)
  const fileIdRef = useRef(file?.id)
  const pendingRef = useRef(null)
  const onSavedRef = useRef(onSaved)
  useEffect(() => { onSavedRef.current = onSaved }, [onSaved])
  const stateCb = useRef(onSaveStateChange)
  useEffect(() => { stateCb.current = onSaveStateChange }, [onSaveStateChange])
  useEffect(() => { stateCb.current?.(saveState) }, [saveState])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    try {
      const updated = await patchFile(pending.fileId, { tag_ids: [...pending.ids] })
      onSavedRef.current?.(updated)
      qc.invalidateQueries({ queryKey: ['files'] })
      qc.invalidateQueries({ queryKey: ['tags'] })
      setSaveState('saved')
      setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1500)
    } catch (err) {
      toast.error(`Could not save tags: ${err.message}`)
      setSaveState('idle')
    }
  }, [qc])

  // New file: flush anything pending for the previous one, then adopt the new file's tags.
  useEffect(() => {
    if (fileIdRef.current !== file?.id) {
      flush()
      fileIdRef.current = file?.id
    }
    setSelectedIds(new Set((file?.tags ?? []).map((t) => t.id)))
    setSaveState('idle')
  }, [file?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reflect tags changed from outside (agent, bulk edit) when nothing is pending.
  const tagSig = (file?.tags ?? []).map((t) => t.id).sort().join(',')
  useEffect(() => {
    if (!pendingRef.current) setSelectedIds(new Set((file?.tags ?? []).map((t) => t.id)))
  }, [tagSig]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { flush() }, [flush])

  const schedule = useCallback((ids) => {
    pendingRef.current = { fileId: file.id, ids }
    setSaveState('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 600)
  }, [file?.id, flush])

  const toggle = useCallback((tagId) => {
    const cat = groups.find((g) => g.tags.some((t) => t.id === tagId))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else {
        if (cat?.selection === 'single') cat.tags.forEach((t) => next.delete(t.id))
        next.add(tagId)
      }
      schedule(next)
      return next
    })
  }, [groups, schedule])

  useEffect(() => {
    if (toggleRef) toggleRef.current = toggle
    return () => { if (toggleRef) toggleRef.current = null }
  }, [toggleRef, toggle])

  const addTag = async (cat, name) => {
    const tag = await createTag({ category_id: cat.id, name })
    qc.invalidateQueries({ queryKey: ['tags'] })
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (cat.selection === 'single') cat.tags.forEach((t) => next.delete(t.id))
      next.add(tag.id)
      schedule(next)
      return next
    })
  }

  const addCategory = async (name) => {
    await createCategory({ name })
    qc.invalidateQueries({ queryKey: ['categories'] })
  }

  if (!file) return null
  if (isLoading) return <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>

  const aiIds = new Set((file.tags ?? []).filter((t) => t.source === 'agent').map((t) => t.id))

  return (
    <div className="flex flex-col gap-5">
      {groups.map((cat) => {
        const readOnly = !!cat.is_system
        const single = cat.selection === 'single'
        const collapse = cat.tags.length > COLLAPSE_AFTER
        const byUse = [...cat.tags].sort((a, b) => (b.file_count || 0) - (a.file_count || 0))
        const inline = collapse
          ? [...cat.tags.filter((t) => selectedIds.has(t.id)), ...byUse.filter((t) => !selectedIds.has(t.id))]
              .slice(0, Math.max(VISIBLE_COUNT, cat.tags.filter((t) => selectedIds.has(t.id)).length))
          : cat.tags
        const hidden = collapse ? cat.tags.filter((t) => !inline.includes(t)) : []
        return (
          <section key={cat.id} aria-labelledby={`cat-${cat.id}`}>
            <div className="mb-1.5 flex items-center gap-1.5">
              <h3 id={`cat-${cat.id}`} className="text-xs font-medium text-muted-foreground">{cat.name}</h3>
              {readOnly && (
                <Tooltip>
                  <TooltipTrigger render={<span className="text-muted-foreground" />}><RiLockLine className="size-3" aria-label="Automatic, read-only" /></TooltipTrigger>
                  <TooltipContent>Set automatically</TooltipContent>
                </Tooltip>
              )}
              {single && <Badge variant="ghost" className="h-4 text-[0.625rem] text-muted-foreground">pick one</Badge>}
            </div>
            {cat.description && <p className="mb-1.5 text-xs text-muted-foreground">{cat.description}</p>}
            <div className="flex flex-wrap items-center gap-1.5" role={single ? 'radiogroup' : 'group'} aria-labelledby={`cat-${cat.id}`}>
              {inline.map((t) => (
                <TagToggle
                  key={t.id}
                  tag={t}
                  active={selectedIds.has(t.id)}
                  aiSourced={aiIds.has(t.id)}
                  disabled={readOnly}
                  onToggle={toggle}
                  hotkey={hotkeys?.get(t.id)}
                />
              ))}
              {hidden.length > 0 && <MoreTags cat={cat} tags={hidden} selectedIds={selectedIds} onToggle={toggle} />}
              {!readOnly && <InlineAdd label="New tag" placeholder="Tag name" onSubmit={(n) => addTag(cat, n)} />}
              {cat.tags.length === 0 && readOnly && <span className="text-xs text-muted-foreground">None</span>}
            </div>
          </section>
        )
      })}
      {showNewCategory && <div><InlineAdd label="New category" placeholder="Category name" onSubmit={addCategory} /></div>}
    </div>
  )
}
