import React, { useState } from 'react'
import {
  RiArrowDownSLine, RiCheckLine, RiUserLine, RiStarLine, RiStarFill, RiPriceTag3Line, RiSparklingLine, RiCloseLine,
} from '@remixicon/react'
import { Button } from '@/components/ui/button.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Checkbox } from '@/components/ui/checkbox.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.jsx'
import { ScrollArea } from '@/components/ui/scroll-area.jsx'
import { Toggle } from '@/components/ui/toggle.jsx'

/** "Uploaded by" filter: one person, or files whose uploader is unknown. */
function UploaderFilter({ value, options, onChange }) {
  const items = [
    { value: '', label: 'Anyone' },
    ...options.map((u) => ({ value: String(u.id), label: u.display_name || u.username })),
    { value: 'none', label: 'Unknown' },
  ]
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant={value ? 'secondary' : 'outline'} size="lg" aria-label={`Filter by uploader${value ? ', one selected' : ''}`} />}
      >
        <RiUserLine data-icon="inline-start" />
        Uploaded by
        {value && <Badge className="h-4 min-w-4 px-1">1</Badge>}
        <RiArrowDownSLine data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 gap-1">
        <ScrollArea className="max-h-64">
          <ul className="grid gap-0.5" role="listbox" aria-label="Uploaded by">
            {items.map((it) => (
              <li key={it.value} role="option" aria-selected={value === it.value}>
                <button
                  type="button"
                  onClick={() => onChange(it.value)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-muted"
                >
                  <RiCheckLine className={`size-3.5 ${value === it.value ? '' : 'invisible'}`} />
                  <span className="flex-1 truncate">{it.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
        <p className="px-1.5 pt-1 text-[0.625rem] text-muted-foreground">Unknown: added before accounts, by the library scan, or with login off.</p>
      </PopoverContent>
    </Popover>
  )
}

function CategoryFilter({ cat, selected, onToggle }) {
  const [query, setQuery] = useState('')
  const count = cat.tags.filter((t) => selected.has(t.id)).length
  const shown = cat.tags.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <Popover onOpenChange={(o) => { if (!o) setQuery('') }}>
      <PopoverTrigger
        render={<Button variant={count ? 'secondary' : 'outline'} size="lg" aria-label={`Filter by ${cat.name}${count ? `, ${count} selected` : ''}`} />}
      >
        {cat.name}
        {count > 0 && <Badge className="h-4 min-w-4 px-1">{count}</Badge>}
        <RiArrowDownSLine data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 gap-2">
        {cat.tags.length > 8 && (
          <Input placeholder={`Search ${cat.name.toLowerCase()}…`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search ${cat.name} tags`} />
        )}
        <ScrollArea className="max-h-64">
          <ul className="grid gap-0.5">
            {shown.map((t) => (
              <li key={t.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted">
                  <Checkbox checked={selected.has(t.id)} onCheckedChange={() => onToggle(t.id)} />
                  <span className="flex-1 truncate">{t.name}</span>
                  <span className="tabular-nums text-muted-foreground">{t.file_count}</span>
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="px-1.5 py-2 text-muted-foreground">No matching tags</li>}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Filter controls and the row of active-filter chips.
 * `filters`: { tags:Set, favorites, untagged, ai }; `groups`: categories with tags.
 */
export default function FilterBar({ groups, tags, filters, onToggleTag, onToggleFlag, onClear, uploaderOptions, onSetUploader }) {
  const { tags: selected, favorites, untagged, ai, uploader = '' } = filters
  const showUploader = !!onSetUploader
  const uploaderName = uploader === 'none' ? 'Unknown' : (uploaderOptions ?? []).find((u) => String(u.id) === uploader)?.display_name ?? `User ${uploader}`
  const tagById = new Map(tags.map((t) => [t.id, t]))
  const active = selected.size > 0 || favorites || untagged || ai || !!uploader
  const visibleGroups = groups.filter((g) => g.tags.length > 0)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filters">
        {visibleGroups.map((cat) => (
          <CategoryFilter key={cat.id} cat={cat} selected={selected} onToggle={onToggleTag} />
        ))}
        {showUploader && <UploaderFilter value={uploader} options={uploaderOptions ?? []} onChange={onSetUploader} />}
        <Toggle variant="outline" size="lg" pressed={favorites} onPressedChange={() => onToggleFlag('favorites')} aria-label="Favorites only">
          {favorites ? <RiStarFill className="text-amber-500" /> : <RiStarLine />} Favorites
        </Toggle>
        <Toggle variant="outline" size="lg" pressed={untagged} onPressedChange={() => onToggleFlag('untagged')} aria-label="Only files with no tags (aspect ratio does not count)">
          <RiPriceTag3Line /> No tags
        </Toggle>
        <Toggle variant="outline" size="lg" pressed={ai} onPressedChange={() => onToggleFlag('ai')} aria-label="Only files tagged by an AI agent">
          <RiSparklingLine /> AI-tagged
        </Toggle>
      </div>

      {active && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {[...selected].map((id) => {
            const t = tagById.get(id)
            return t ? <Chip key={id} onRemove={() => onToggleTag(id)}>{t.category_name}: {t.name}</Chip> : null
          })}
          {favorites && <Chip onRemove={() => onToggleFlag('favorites')}>Favorites</Chip>}
          {untagged && <Chip onRemove={() => onToggleFlag('untagged')}>No tags</Chip>}
          {ai && <Chip onRemove={() => onToggleFlag('ai')}>AI-tagged</Chip>}
          {uploader && <Chip onRemove={() => onSetUploader('')}>Uploaded by: {uploaderName}</Chip>}
          <Button variant="ghost" size="sm" onClick={onClear}>Clear all</Button>
        </div>
      )}
    </div>
  )
}

function Chip({ children, onRemove }) {
  return (
    <Badge variant="secondary" className="h-6 gap-1 pr-1 text-xs">
      {children}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter ${React.Children.toArray(children).join('')}`}
        className="rounded-full p-0.5 hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RiCloseLine className="size-3" />
      </button>
    </Badge>
  )
}
