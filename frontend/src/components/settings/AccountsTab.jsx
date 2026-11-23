import React, { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RiShieldUserLine, RiLockUnlockLine, RiKey2Line, RiLoginBoxLine, RiUserAddLine, RiLogoutBoxRLine } from '@remixicon/react'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogMedia, AlertDialogTitle,
} from '@/components/ui/alert-dialog.jsx'
import { authDisable, authEnable, authSetup, updateMe } from '@/api/client.js'
import { useAuth } from '@/context/AuthContext.jsx'
import UserAvatar from '@/components/UserAvatar.jsx'
import ChangePasswordDialog, { MIN_PASSWORD } from '@/components/account/ChangePasswordDialog.jsx'
import UsersCard from '@/components/settings/UsersCard.jsx'
import AuditCard from '@/components/settings/AuditCard.jsx'

function ErrorLine({ children }) {
  return children ? <p role="alert" className="text-xs text-destructive">{children}</p> : null
}

const retryText = (err) => (err.status === 429 && err.retryAfter ? ` Try again in ${Math.ceil(err.retryAfter / 60)} min.` : '')

/** Login is off: explain, then either create the first admin or let an existing admin switch it on. */
function TurnOnCard() {
  const { setupRequired, reset } = useAuth()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [started, setStarted] = useState(false)
  const [error, setError] = useState(null)

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const mismatch = again.length > 0 && again !== password
  const valid = setupRequired
    ? username.trim() && displayName.trim() && password.length >= MIN_PASSWORD && password === again
    : username.trim() && password

  const go = useMutation({
    mutationFn: () => (setupRequired
      ? authSetup({ username: username.trim(), display_name: displayName.trim(), password })
      : authEnable({ username: username.trim(), password })),
    onSuccess: async ({ user }) => {
      toast.success('Login is on. You are signed in.')
      await reset({ enabled: true, setup_required: false, user })
    },
    onError: (e) => { setError(e.message + retryText(e)); setPassword(''); setAgain('') },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Login <Badge variant="secondary">Off</Badge></CardTitle>
        <CardDescription>
          Right now anyone who can reach this server has full access. Turn login on when more than one person uses the library:
          every file then shows who added it, and each change is recorded in the file's History.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ul className="grid list-disc gap-1 pl-4 text-xs text-muted-foreground">
          <li>The first account is an administrator. Add everyone else afterwards.</li>
          <li>Your Agent API tokens and MCP connections keep working the same way.</li>
          <li>An administrator can turn login off again at any time. Accounts and history are kept.</li>
        </ul>

        {!started ? (
          <div><Button onClick={() => setStarted(true)}><RiLockUnlockLine data-icon="inline-start" /> Turn on login</Button></div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (valid && !go.isPending) { setError(null); go.mutate() } }} className="grid max-w-sm gap-3">
            <p className="text-sm font-medium">
              {setupRequired ? 'Create the administrator account' : 'Sign in as an administrator to turn login on'}
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="on-username">Username</Label>
              <Input id="on-username" autoComplete="username" autoCapitalize="none" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            {setupRequired && (
              <div className="grid gap-1.5">
                <Label htmlFor="on-display">Display name</Label>
                <Input id="on-display" placeholder="Shown next to your uploads" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="on-password">Password</Label>
              <Input id="on-password" type="password" autoComplete={setupRequired ? 'new-password' : 'current-password'}
                value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={setupRequired && tooShort} />
              {setupRequired && <p className={`text-xs ${tooShort ? 'text-destructive' : 'text-muted-foreground'}`}>At least {MIN_PASSWORD} characters.</p>}
            </div>
            {setupRequired && (
              <div className="grid gap-1.5">
                <Label htmlFor="on-again">Repeat password</Label>
                <Input id="on-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} aria-invalid={mismatch} />
                {mismatch && <p className="text-xs text-destructive">Passwords do not match.</p>}
              </div>
            )}
            <ErrorLine>{error}</ErrorLine>
            <div className="flex gap-2">
              <Button type="submit" disabled={!valid || go.isPending}>
                {go.isPending ? 'Working…' : setupRequired ? 'Create admin and turn on login' : 'Turn on login'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => { setStarted(false); setError(null) }}>Cancel</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function MyAccountCard() {
  const { user, reset, signOut } = useAuth()
  const [name, setName] = useState(user.display_name)
  const [pwOpen, setPwOpen] = useState(false)
  const save = useMutation({
    mutationFn: () => updateMe(name.trim()),
    onSuccess: ({ user: u }) => { toast.success('Name saved'); reset({ enabled: true, setup_required: false, user: u }).then(() => {}) },
    onError: (e) => toast.error(e.message),
  })
  const changed = name.trim() && name.trim() !== user.display_name
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserAvatar name={user.display_name} size="lg" /> My account
          <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role}</Badge>
        </CardTitle>
        <CardDescription>Signed in as <code>@{user.username}</code>.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={(e) => { e.preventDefault(); if (changed) save.mutate() }} className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="my-display">Display name</Label>
            <Input id="my-display" className="w-64" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" disabled={!changed || save.isPending}>Save</Button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setPwOpen(true)}><RiKey2Line data-icon="inline-start" /> Change password</Button>
          <Button variant="outline" onClick={() => signOut()}><RiLogoutBoxRLine data-icon="inline-start" /> Sign out</Button>
        </div>
      </CardContent>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </Card>
  )
}

function TurnOffCard() {
  const { reset } = useAuth()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const off = useMutation({
    mutationFn: () => authDisable(password),
    onSuccess: async () => { setOpen(false); toast.success('Login is off'); await reset() },
    onError: (e) => { setError(e.message + retryText(e)); setPassword('') },
  })
  const close = (o) => { setOpen(o); if (!o) { setPassword(''); setError(null) } }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Turn off login</CardTitle>
        <CardDescription>
          Anyone who can reach this server gets full access again. Accounts, uploaders and history are kept, and you can turn login back on later.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}><RiLockUnlockLine data-icon="inline-start" /> Turn off login…</Button>
      </CardContent>
      <AlertDialog open={open} onOpenChange={close}>
        <AlertDialogContent size="sm">
          <form onSubmit={(e) => { e.preventDefault(); if (password && !off.isPending) { setError(null); off.mutate() } }} className="grid gap-3">
            <AlertDialogHeader>
              <AlertDialogMedia><RiLockUnlockLine /></AlertDialogMedia>
              <AlertDialogTitle>Turn off login?</AlertDialogTitle>
              <AlertDialogDescription>Everyone will have full access without signing in. Enter your password to confirm.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="off-password">Your password</Label>
              <Input id="off-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
              <ErrorLine>{error}</ErrorLine>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={!password || off.isPending}>{off.isPending ? 'Turning off…' : 'Turn off login'}</Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

export default function AccountsTab() {
  const { enabled, user } = useAuth()
  if (!enabled) return <div className="grid gap-4"><TurnOnCard /></div>
  return (
    <div className="grid gap-4">
      <MyAccountCard />
      {user?.role === 'admin' ? (
        <>
          <UsersCard />
          <AuditCard />
          <TurnOffCard />
        </>
      ) : (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <RiShieldUserLine className="size-4" aria-hidden /> Managing users, the audit log and turning login off are for administrators.
        </p>
      )}
    </div>
  )
}
