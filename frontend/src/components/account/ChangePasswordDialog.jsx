import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.jsx'
import { changeOwnPassword } from '@/api/client.js'

export const MIN_PASSWORD = 10

export default function ChangePasswordDialog({ open, onOpenChange }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { if (open) { setCurrent(''); setNext(''); setAgain(''); setError(null) } }, [open])

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD
  const mismatch = again.length > 0 && again !== next
  const valid = current && next.length >= MIN_PASSWORD && next === again

  const submit = async (e) => {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true); setError(null)
    try {
      await changeOwnPassword(current, next)
      toast.success('Password changed. Your other sessions were signed out.')
      onOpenChange(false)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>You stay signed in here. Other devices are signed out.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="pw-current">Current password</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pw-new">New password</Label>
            <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={tooShort} />
            <p className={`text-xs ${tooShort ? 'text-destructive' : 'text-muted-foreground'}`}>At least {MIN_PASSWORD} characters.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pw-again">Repeat new password</Label>
            <Input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} aria-invalid={mismatch} />
            {mismatch && <p className="text-xs text-destructive">Passwords do not match.</p>}
          </div>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || busy}>{busy ? 'Saving…' : 'Change password'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
