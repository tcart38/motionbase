import React, { useEffect, useState } from 'react'
import { RiAlertLine, RiFilmLine, RiLoginBoxLine, RiTimeLine } from '@remixicon/react'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Spinner } from '@/components/ui/spinner.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { authLogin } from '@/api/client.js'
import { useAuth } from '@/context/AuthContext.jsx'

const clock = (secs) => {
  const m = Math.floor(secs / 60)
  return m > 0 ? `${m}m ${String(secs % 60).padStart(2, '0')}s` : `${secs}s`
}

export default function Login() {
  const { reset, setupRequired } = useAuth()
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

  const left = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0
  const limited = left > 0

  const submit = async (e) => {
    e.preventDefault()
    if (busy || limited) return
    setBusy(true); setError(null)
    try {
      const { user } = await authLogin({ username: username.trim(), password })
      const status = { enabled: true, setup_required: false, user }
      await reset(status)
    } catch (err) {
      if (err.status === 429) {
        const secs = err.retryAfter || 60
        setUntil(Date.now() + secs * 1000); setNow(Date.now())
        setError('Too many failed attempts.')
      } else {
        setError(err.message)
      }
      setPassword('')
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
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              {setupRequired ? 'Login is on but no account exists yet. See docs/ACCOUNTS.md to recover.' : 'Enter your username and password to continue.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4" noValidate>
              <div className="grid gap-1.5">
                <Label htmlFor="login-username">Username</Label>
                <Input id="login-username" name="username" autoComplete="username" autoCapitalize="none" autoFocus required
                  value={username} onChange={(e) => setUsername(e.target.value)} aria-invalid={!!error} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="login-password">Password</Label>
                <Input id="login-password" name="password" type="password" autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error}
                  aria-describedby={error ? 'login-error' : undefined} />
              </div>

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

              <Button type="submit" size="lg" disabled={busy || limited || !username.trim() || !password}>
                {busy ? <Spinner data-icon="inline-start" /> : <RiLoginBoxLine data-icon="inline-start" />}
                {busy ? 'Signing in…' : limited ? `Wait ${clock(left)}` : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Forgot your password? Ask an administrator to reset it.
        </p>
      </div>
    </main>
  )
}
