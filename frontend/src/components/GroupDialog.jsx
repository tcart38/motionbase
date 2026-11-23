import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog.jsx'

/** Name a new media group (mode "create") or rename one (mode "rename"). onSubmit(title) may be async; the dialog closes after it. */
export default function GroupDialog({ open, onOpenChange, mode = 'create', initialTitle = '', count, onSubmit }) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (open) { setTitle(initialTitle); setError(''); setBusy(false) } }, [open, initialTitle])

  const submit = async (e) => {
    e.preventDefault()
    const t = title.trim()
    if (mode === 'rename' && !t) { setError('Enter a name'); return }
    setBusy(true)
    try { await onSubmit(t); onOpenChange(false) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{mode === 'rename' ? 'Rename group' : 'Group clips'}</DialogTitle>
            <DialogDescription>
              {mode === 'rename'
                ? 'Only the group name changes; each clip keeps its own file name.'
                : `${count ?? 'These'} clips become one entry in the Library. Each keeps its own tags, notes and history.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="group-title">Group name</Label>
            <Input
              id="group-title"
              autoFocus
              value={title}
              onChange={(e) => { setTitle(e.target.value); setError('') }}
              placeholder={mode === 'create' ? 'Optional: defaults to the first clip’s caption' : undefined}
              aria-invalid={!!error}
              maxLength={200}
            />
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{mode === 'rename' ? 'Rename' : 'Group'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
