import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RiUserAddLine, RiKey2Line, RiProhibitedLine, RiCheckLine } from '@remixicon/react'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Skeleton } from '@/components/ui/skeleton.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from '@/components/ui/card.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.jsx'
import { approveUser, createUser, getUsers, rejectUser, resetUserPassword, updateUser } from '@/api/client.js'
import { useAuth } from '@/context/AuthContext.jsx'
import UserAvatar from '@/components/UserAvatar.jsx'
import { MIN_PASSWORD } from '@/components/account/ChangePasswordDialog.jsx'
import { absoluteTime, relativeTime } from '@/lib/people.js'

const ROLES = [{ value: 'user', label: 'User' }, { value: 'admin', label: 'Admin' }]

function CreateUserDialog({ open, onOpenChange }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ username: '', display_name: '', role: 'user', password: '' })
  const [error, setError] = useState(null)
  useEffect(() => { if (open) { setF({ username: '', display_name: '', role: 'user', password: '' }); setError(null) } }, [open])
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const create = useMutation({
    mutationFn: () => createUser({ ...f, username: f.username.trim(), display_name: f.display_name.trim() }),
    onSuccess: ({ user }) => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success(`Created ${user.display_name}`); onOpenChange(false) },
    onError: (e) => setError(e.message),
  })
  const valid = f.username.trim() && f.display_name.trim() && f.password.length >= MIN_PASSWORD
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={(e) => { e.preventDefault(); if (valid && !create.isPending) { setError(null); create.mutate() } }} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a user</DialogTitle>
            <DialogDescription>Give them the username and the initial password. They can change it after signing in.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="nu-username">Username</Label>
            <Input id="nu-username" autoCapitalize="none" autoComplete="off" autoFocus value={f.username} onChange={set('username')} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nu-display">Display name</Label>
            <Input id="nu-display" autoComplete="off" value={f.display_name} onChange={set('display_name')} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nu-role">Role</Label>
            <Select items={ROLES} value={f.role} onValueChange={(v) => setF((p) => ({ ...p, role: v }))}>
              <SelectTrigger id="nu-role" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nu-password">Initial password</Label>
            <Input id="nu-password" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />
            <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD} characters.</p>
          </div>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!valid || create.isPending}>{create.isPending ? 'Creating…' : 'Create user'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({ user, onClose }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  useEffect(() => { setPassword(''); setError(null) }, [user])
  const reset = useMutation({
    mutationFn: () => resetUserPassword(user.id, password),
    onSuccess: () => { toast.success(`Password reset for ${user.display_name}. They were signed out everywhere.`); onClose() },
    onError: (e) => setError(e.message),
  })
  const valid = password.length >= MIN_PASSWORD
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={(e) => { e.preventDefault(); if (valid && !reset.isPending) { setError(null); reset.mutate() } }} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Reset password for {user?.display_name}</DialogTitle>
            <DialogDescription>They will be signed out on every device and need the new password to get back in.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="rp-password">New password</Label>
            <Input id="rp-password" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD} characters.</p>
          </div>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!valid || reset.isPending}>{reset.isPending ? 'Saving…' : 'Reset password'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function UsersCard() {
  const qc = useQueryClient()
  const { user: me } = useAuth()
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: getUsers })
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState(null)
  // Refresh the list after any change; the server's guard messages ("at least one active administrator") are shown as-is.
  const patch = useMutation({
    mutationFn: ({ id, ...body }) => updateUser(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e) => { toast.error(e.message); qc.invalidateQueries({ queryKey: ['users'] }) },
  })
  const review = useMutation({
    mutationFn: ({ id, approve }) => (approve ? approveUser(id) : rejectUser(id)),
    onSuccess: (_, { approve, name }) => { toast.success(approve ? `Approved ${name}` : `Rejected ${name}`); qc.invalidateQueries({ queryKey: ['users'] }) },
    onError: (e) => { toast.error(e.message); qc.invalidateQueries({ queryKey: ['users'] }) },
  })
  const users = data?.users ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Users {data?.pending_count > 0 && <Badge>{data.pending_count} pending</Badge>}</CardTitle>
        <CardDescription>
          Accounts are disabled, never deleted, so history keeps everyone's name. There is always at least one active administrator.
        </CardDescription>
        <CardAction><Button onClick={() => setCreating(true)}><RiUserAddLine data-icon="inline-start" /> Add user</Button></CardAction>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-24 w-full" />}
        {data && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Files</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const self = u.id === me?.id
                return (
                  <TableRow key={u.id} className={u.disabled ? 'opacity-60' : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <UserAvatar name={u.display_name} />
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate font-medium">
                            {u.display_name}
                            {self && <Badge variant="outline">you</Badge>}
                            {u.disabled && <Badge variant="secondary">disabled</Badge>}
                            {u.pending && <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">Pending</Badge>}
                          </p>
                          <p className="truncate text-muted-foreground">@{u.username}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {u.pending ? <span className="text-muted-foreground">User</span> : <Select items={ROLES} value={u.role} onValueChange={(role) => role !== u.role && patch.mutate({ id: u.id, role })}>
                        <SelectTrigger size="sm" className="w-24" aria-label={`Role of ${u.display_name}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                      </Select>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{u.file_count}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground" title={u.last_login_at ? absoluteTime(u.last_login_at) : undefined}>
                      {u.last_login_at ? relativeTime(u.last_login_at) : 'never'}
                    </TableCell>
                    <TableCell>
                      {u.pending ? (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: u.id, approve: true, name: u.display_name })} aria-label={`Approve ${u.display_name}`}>
                            <RiCheckLine data-icon="inline-start" /> Approve
                          </Button>
                          <Button variant="outline" size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: u.id, approve: false, name: u.display_name })} aria-label={`Reject ${u.display_name}`}>
                            <RiProhibitedLine data-icon="inline-start" /> Reject
                          </Button>
                        </div>
                      ) : (
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => setResetting(u)} aria-label={`Reset password for ${u.display_name}`}>
                          <RiKey2Line data-icon="inline-start" /> Reset
                        </Button>
                        <Button variant="outline" size="sm" disabled={patch.isPending || (self && !u.disabled)}
                          title={self && !u.disabled ? 'You cannot disable your own account' : undefined}
                          onClick={() => patch.mutate({ id: u.id, disabled: !u.disabled })}
                          aria-label={`${u.disabled ? 'Enable' : 'Disable'} ${u.display_name}`}>
                          {u.disabled ? <RiCheckLine data-icon="inline-start" /> : <RiProhibitedLine data-icon="inline-start" />}
                          {u.disabled ? 'Enable' : 'Disable'}
                        </Button>
                      </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </Card>
  )
}
