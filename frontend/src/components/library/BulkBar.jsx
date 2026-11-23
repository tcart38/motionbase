import React, { useState } from 'react'
import {
  RiCloseLine, RiPriceTag3Line, RiFolderTransferLine, RiStarLine, RiCheckDoubleLine, RiCheckLine,
} from '@remixicon/react'
import { Button } from '@/components/ui/button.jsx'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.jsx'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command.jsx'
import { Separator } from '@/components/ui/separator.jsx'

/** Tag picker for several files: a tag shows a check when every selected file has it; choosing toggles it. */
function BulkTagPopover({ groups, files, onAdd, onRemove }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" />}>
        <RiPriceTag3Line data-icon="inline-start" /> Tag
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Find a tag…" />
          <CommandList className="max-h-64">
            <CommandEmpty>No tags found.</CommandEmpty>
            {groups.filter((g) => !g.is_system && g.tags.length).map((g) => (
              <CommandGroup key={g.id} heading={g.name}>
                {g.tags.map((t) => {
                  const count = files.filter((f) => f.tags?.some((x) => x.id === t.id)).length
                  const all = count === files.length
                  return (
                    <CommandItem
                      key={t.id}
                      value={`${g.name} ${t.name}`}
                      data-checked={all}
                      onSelect={() => (all ? onRemove(files, t) : onAdd(files, t))}
                    >
                      <span className="flex-1 truncate">{t.name}</span>
                      {count > 0 && !all && <span className="text-muted-foreground">{count}/{files.length}</span>}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Sticky action bar shown while files are selected. `files` are the selected file objects. */
export default function BulkBar({
  files, total, groups, onClear, onSelectAll, onAddTag, onRemoveTag, onMove, onFavorite, onMarkReviewed,
}) {
  const allFav = files.length > 0 && files.every((f) => f.is_favorite)
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="sticky bottom-3 z-30 mx-auto mt-auto flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1.5 rounded-xl bg-popover p-2 text-popover-foreground shadow-lg ring-1 ring-foreground/15"
    >
      <span className="px-2 text-xs font-medium tabular-nums" aria-live="polite">{files.length} selected</span>
      <Separator orientation="vertical" className="h-5" />
      <BulkTagPopover groups={groups} files={files} onAdd={onAddTag} onRemove={onRemoveTag} />
      <Button variant="outline" onClick={onMove}><RiFolderTransferLine data-icon="inline-start" /> Move</Button>
      <Button variant="outline" onClick={() => onFavorite(!allFav)}>
        <RiStarLine data-icon="inline-start" /> {allFav ? 'Unfavorite' : 'Favorite'}
      </Button>
      <Button variant="outline" onClick={onMarkReviewed}><RiCheckDoubleLine data-icon="inline-start" /> Mark reviewed</Button>
      <Separator orientation="vertical" className="h-5" />
      {files.length < total && <Button variant="ghost" onClick={onSelectAll}>Select all {total}</Button>}
      <Button variant="ghost" size="icon" onClick={onClear} aria-label="Clear selection"><RiCloseLine /></Button>
    </div>
  )
}
