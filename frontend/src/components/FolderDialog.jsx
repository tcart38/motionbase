import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog.jsx'
import { useFolderMutations } from '@/hooks/useFolders.js'

/**
 * Create or rename a folder.
 * mode "create": parentId is the parent (null = top level). mode "rename": folder is the folder.
 */
export default function FolderDialog({ open, onOpenChange, mode = 'create', folder, parentId = null, parentName, onDone }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const { create, update } = useFolderMutations()
  const busy = create.isPending || update.isPending

  useEffect(() => {
    if (open) { setName(mode === 'rename' ? folder?.name ?? '' : ''); setError('') }
  }, [open, mode, folder])

  const submit = async (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Enter a name'); return }
    try {
      const result = mode === 'rename'
        ? await update.mutateAsync({ id: folder.id, name: trimmed })
        : await create.mutateAsync({ name: trimmed, parent_id: parentId })
      onOpenChange(false)
      onDone?.(result)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{mode === 'rename' ? 'Rename folder' : parentId != null ? 'New subfolder' : 'New folder'}</DialogTitle>
            <DialogDescription>
              {mode === 'rename'
                ? 'Folders are virtual; files on disk are not touched.'
                : parentName ? `Created inside ${parentName}.` : 'Folders are virtual; files on disk are not touched.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="folder-name">Name</Label>
            <Input
              id="folder-name"
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setError('') }}
              aria-invalid={!!error}
              aria-describedby={error ? 'folder-name-error' : undefined}
              maxLength={200}
            />
            {error && <p id="folder-name-error" role="alert" className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{mode === 'rename' ? 'Rename' : 'Create'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
