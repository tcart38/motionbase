import React, { useEffect, useState } from 'react'
import { RiAlertLine, RiCheckboxCircleLine, RiFilmLine, RiLoginBoxLine, RiTimeLine, RiUserAddLine } from '@remixicon/react'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Spinner } from '@/components/ui/spinner.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { authLogin, authSignup } from '@/api/client.js'
import { useAuth } from '@/context/AuthContext.jsx'

const MIN_PASSWORD = 10

const clock = (secs) => {
  const m = Math.floor(secs / 60)
  return m > 0 ? `${m}m ${String(secs % 60).padStart(2, '0')}s` : `${secs}s`
}

export default function Login() {
  const { reset, setupRequired, signupsEnabled, signupsRequireApproval } = useAuth()
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [displayName, setDisplayName] = useState('')
  const [again, setAgain] = useState('')
  const [created, setCreated] = useState(false) // sign-up done, waiting for approval
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [until, setUntil] = useState(null) // epoch ms when the rate limit lifts
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!until) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [until])

  const signup = mode === 'signup' && signupsEnabled
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const mismatch = again.length > 0 && again !== password
  const switchMode = (m) => { setMode(m); setError(null); setUntil(null); setPassword(''); setAgain(''); setCreated(false) }

  const left = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0
  const limited = left > 0

  const submit = async (e) => {
    e.preventDefault()
    if (busy || limited) return
    setBusy(true); setError(null)
    try {
      if (signup) {
        const res = await authSignup({ username: username.trim(), display_name: displayName.trim() || username.trim(), password })
        if (res.pending) { setCreated(true); setPassword(''); setAgain(''); return }
        await reset({ enabled: true, setup_required: false, user: res.user })
        return
      }
      const { user } = await authLogin({ username: username.trim(), password })
      const status = { enabled: true, setup_required: false, user }
      await reset(status)
    } catch (err) {
      if (err.status === 429) {
        const secs = err.retryAfter || 60
        setUntil(Date.now() + secs * 1000); setNow(Date.now())
        setError(signup ? 'Too many sign-ups. Please try again later.' : 'Too many failed attempts.')
      } else {
        setError(err.message)
      }
      setPassword(''); setAgain('')
    } finally { setBusy(false) }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <RiFilmLine className="size-5" aria-hidden />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">MotionBase</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{signup ? 'Create account' : 'Sign in'}</CardTitle>
            <CardDescription>
              {signup
                ? 'Pick a username and password. New accounts are normal users.'
                : setupRequired ? 'Login is on but no account exists yet. See docs/ACCOUNTS.md to recover.' : 'Enter your username and password to continue.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {created ? (
              <div className="grid gap-4">
                <div role="status" className="flex items-start gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm">
                  <RiCheckboxCircleLine className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <p>Account created. An admin must approve it before you can sign in.</p>
                </div>
                <Button type="button" variant="outline" onClick={() => switchMode('signin')}>Back to sign in</Button>
              </div>
            ) : (
            <form onSubmit={submit} className="grid gap-4" noValidate>
              <div className="grid gap-1.5">
                <Label htmlFor="login-username">Username</Label>
                <Input id="login-username" name="username" autoComplete="username" autoCapitalize="none" autoFocus required
                  value={username} onChange={(e) => setUsername(e.target.value)} aria-invalid={!!error} />
              </div>
              {signup && (
                <div className="grid gap-1.5">
                  <Label htmlFor="login-display">Display name</Label>
                  <Input id="login-display" name="display_name" autoComplete="name" placeholder="Shown next to your uploads"
                    value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="login-password">Password</Label>
                <Input id="login-password" name="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} required
                  value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error || (signup && tooShort)}
                  aria-describedby={error ? 'login-error' : undefined} />
                {signup && <p className={`text-xs ${tooShort ? 'text-destructive' : 'text-muted-foreground'}`}>Use at least {MIN_PASSWORD} characters.</p>}
              </div>
              {signup && (
                <div className="grid gap-1.5">
                  <Label htmlFor="login-again">Confirm password</Label>
                  <Input id="login-again" name="confirm" type="password" autoComplete="new-password" required
                    value={again} onChange={(e) => setAgain(e.target.value)} aria-invalid={mismatch} />
                  {mismatch && <p className="text-xs text-destructive">Passwords do not match.</p>}
                </div>
              )}

              {error && (
                <div id="login-error" role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {limited ? <RiTimeLine className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <RiAlertLine className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
                  <div>
                    <p>{error}</p>
                    {limited && (
                      <p className="mt-0.5 text-destructive/80">
                        Try again in <span className="font-medium tabular-nums">{clock(left)}</span>
                        {' '}(at {new Date(until).toLocaleTimeString([], { timeStyle: 'short' })}).
                      </p>
                    )}
                  </div>
                </div>
              )}

              <Button type="submit" size="lg"
                disabled={busy || limited || !username.trim() || !password || (signup && (password.length < MIN_PASSWORD || password !== again))}>
                {busy ? <Spinner data-icon="inline-start" /> : signup ? <RiUserAddLine data-icon="inline-start" /> : <RiLoginBoxLine data-icon="inline-start" />}
                {busy ? (signup ? 'Creating…' : 'Signing in…') : limited ? `Wait ${clock(left)}` : signup ? 'Create account' : 'Sign in'}
              </Button>
              {signup && (
                <p className="text-xs text-muted-foreground">
                  {signupsRequireApproval ? 'An administrator has to approve new accounts before you can sign in.' : 'You will be signed in right away.'}
                </p>
              )}
            </form>
            )}
          </CardContent>
        </Card>
        {signupsEnabled && !setupRequired && !created && (
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {signup ? 'Already have an account? ' : 'New here? '}
            <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={() => switchMode(signup ? 'signin' : 'signup')}>
              {signup ? 'Sign in' : 'Create account'}
            </button>
          </p>
        )}
        {!signup && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Forgot your password? Ask an administrator to reset it.
          </p>
        )}
      </div>
    </main>
  )
}
