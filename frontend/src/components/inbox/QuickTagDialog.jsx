import React from 'react'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command.jsx'

/** Keyboard-first tag picker (opened with T). Picking a tag toggles it on the current file. */
export default function QuickTagDialog({ open, onOpenChange, groups, selectedIds, onToggle }) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Tag this file" description="Type to find a tag, Enter to toggle it.">
      <CommandInput placeholder="Find a tag…" />
      <CommandList>
        <CommandEmpty>No tags found.</CommandEmpty>
        {groups.filter((g) => !g.is_system && g.tags.length).map((g) => (
          <CommandGroup key={g.id} heading={g.name}>
            {g.tags.map((t) => (
              <CommandItem
                key={t.id}
                value={`${g.name} ${t.name}`}
                data-checked={selectedIds.has(t.id)}
                onSelect={() => { onToggle(t.id); onOpenChange(false) }}
              >
                {t.name}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
