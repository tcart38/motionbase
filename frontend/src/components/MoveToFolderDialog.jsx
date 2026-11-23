import React, { useMemo, useState } from 'react'
import { RiFolderLine, RiFolderOpenLine, RiInboxUnarchiveLine, RiAddLine } from '@remixicon/react'
import { Button } from '@/components/ui/button.jsx'
import { ScrollArea } from '@/components/ui/scroll-area.jsx'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog.jsx'
import { useFolders } from '@/hooks/useFolders.js'
import { buildTree, flattenTree } from '@/lib/folders.js'
import { cn } from '@/lib/utils.js'
import FolderDialog from './FolderDialog.jsx'

/**
 * Pick a destination folder. onSelect(folderId | null, folder?) — null means "Unfiled" / top level.
 * excludeIds hides folders that are not valid targets (e.g. a folder and its descendants when moving a folder).
 */
export default function MoveToFolderDialog({
  open, onOpenChange, title = 'Move to folder', description, onSelect,
  excludeIds, allowRoot = true, rootLabel = 'Unfiled (no folder)', confirmLabel = 'Move here',
}) {
  const { data } = useFolders()
  const [selected, setSelected] = useState(undefined) // undefined = nothing chosen yet
  const [creating, setCreating] = useState(false)

  const rows = useMemo(() => {
    const flat = flattenTree(buildTree(data?.folders ?? []))
    return excludeIds ? flat.filter((f) => !excludeIds.has(f.id)) : flat
  }, [data, excludeIds])

  const choose = () => {
    onSelect(selected, rows.find((r) => r.id === selected))
    onOpenChange(false)
  }

  const renderRow = ({ id, label, depth = 0, icon: Icon }) => (
    <button
      key={String(id)}
      type="button"
      role="option"
      aria-selected={selected === id}
      onClick={() => setSelected(id)}
      onDoubleClick={() => { setSelected(id); onSelect(id, rows.find((r) => r.id === id)); onOpenChange(false) }}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={cn(
        'flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40',
        selected === id && 'bg-primary/10 font-medium text-primary hover:bg-primary/15'
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setSelected(undefined) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description ?? 'Choose where to put it.'}</DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-64 rounded-md border">
            <div role="listbox" aria-label="Folders" className="p-1">
              {allowRoot && renderRow({ id: null, label: rootLabel, icon: RiInboxUnarchiveLine })}
              {rows.map((f) => renderRow({ id: f.id, label: f.name, depth: f.depth, icon: selected === f.id ? RiFolderOpenLine : RiFolderLine }))}
              {rows.length === 0 && (
                <p className="px-2 py-3 text-xs text-muted-foreground">No folders yet. Create one to get started.</p>
              )}
            </div>
          </ScrollArea>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => setCreating(true)}>
              <RiAddLine data-icon="inline-start" /> New folder
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="button" onClick={choose} disabled={selected === undefined}>{confirmLabel}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FolderDialog
        open={creating}
        onOpenChange={setCreating}
        mode="create"
        parentId={typeof selected === 'number' ? selected : null}
        parentName={rows.find((r) => r.id === selected)?.name}
        onDone={(f) => setSelected(f.id)}
      />
    </>
  )
}
