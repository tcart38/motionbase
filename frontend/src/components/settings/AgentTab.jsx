import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RiAddLine, RiFileCopyLine, RiKey2Line, RiArrowGoBackLine, RiHistoryLine } from '@remixicon/react'
import {
  getSettings, updateSettings, getTokens, createApiToken, revokeApiToken, getActivity, revertActivity,
} from '@/api/client.js'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Switch } from '@/components/ui/switch.jsx'
import { Skeleton } from '@/components/ui/skeleton.jsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog.jsx'
import { useAuth } from '@/context/AuthContext.jsx'
import AgentDocs from '@/components/settings/AgentDocs.jsx'
import ConfirmAction from '@/components/ConfirmAction.jsx'

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
// SQLite datetime('now') is UTC without a zone marker
const when = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never')

function ConfirmationCard() {
  const { isAdmin } = useAuth()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const on = data?.agent_requires_confirmation === 'true'
  const m = useMutation({
    mutationFn: (v) => updateSettings({ agent_requires_confirmation: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (e) => toast.error(e.message),
  })
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <Label htmlFor="agent-confirm" className="text-sm">Require my confirmation</Label>
          <p className="text-xs text-muted-foreground">
            When on, files an agent has tagged stay in your Inbox under "Needs review" until you confirm them.
            When off, agent changes count as reviewed straight away (you can still revert them below).
            {!isAdmin && ' Only an administrator can change this.'}
          </p>
        </div>
        <Switch id="agent-confirm" checked={on} disabled={!data || m.isPending || !isAdmin} onCheckedChange={(v) => m.mutate(v)} />
      </CardContent>
    </Card>
  )
}

function TokenCard() {
  const { enabled, isAdmin } = useAuth()
  const qc = useQueryClient()
  const { data: tokens, isLoading } = useQuery({ queryKey: ['tokens'], queryFn: getTokens })
  const [name, setName] = useState('')
  const [created, setCreated] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const create = useMutation({
    mutationFn: () => createApiToken(name.trim()),
    onSuccess: (t) => { setCreated(t); setName(''); qc.invalidateQueries({ queryKey: ['tokens'] }) },
    onError: (e) => toast.error(e.message),
  })
  const revoke = useMutation({
    mutationFn: revokeApiToken,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tokens'] }); toast.success('Token revoked') },
    onError: (e) => toast.error(e.message),
  })
  const copy = async () => {
    try { await navigator.clipboard.writeText(created.token); toast.success('Copied') } catch { toast.error('Copy failed, select the token and copy it manually') }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>API tokens</CardTitle>
        <CardDescription>
          Agents send a token as <code>Authorization: Bearer mb_…</code> to <code>/api/agent/v1</code>.
          See docs/AGENT_API.md. Tokens are shown once and stored hashed.
          {enabled && (isAdmin
            ? ' Each token belongs to the person who created it; as an administrator you see everyone\'s.'
            : ' Tokens belong to you and show only to you. Changes an agent makes are credited to you.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate() }} className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="token-name">Token name</Label>
            <Input id="token-name" placeholder="e.g. triage agent" className="w-56" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" disabled={!name.trim() || create.isPending}><RiAddLine /> Create token</Button>
        </form>

        {isLoading && <Skeleton className="h-12 w-full" />}
        {tokens && tokens.length === 0 && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><RiKey2Line /></EmptyMedia>
              <EmptyTitle>No tokens yet</EmptyTitle>
              <EmptyDescription>Create one to let an agent connect.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {tokens?.length > 0 && (
          <ul className="divide-y rounded-lg ring-1 ring-foreground/10">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {t.name} {t.revoked_at && <Badge variant="secondary">revoked</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <code>{t.token_prefix}…</code> · created {when(t.created_at)} · last used {when(t.last_used_at)}
                  </p>
                </div>
                {enabled && isAdmin && (
                  <div className="w-36 shrink-0 text-xs" aria-label="Owner">
                    <span className="mr-1 text-muted-foreground">Owner</span>
                    {t.owner ? <span className="font-medium">{t.owner.display_name}</span> : <span className="text-muted-foreground">none (made before login)</span>}
                  </div>
                )}
                {!t.revoked_at && (
                  <Button variant="destructive" size="sm" aria-label={`Revoke token ${t.name}`}
                    onClick={() => setConfirm({
                      title: `Revoke "${t.name}"?`,
                      description: 'Anything using this token will stop working immediately.',
                      confirmLabel: 'Revoke',
                      onConfirm: () => revoke.mutate(t.id),
                    })}>Revoke</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Copy your token now</DialogTitle>
            <DialogDescription>This is the only time it is shown. Store it somewhere safe.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly aria-label="New API token" value={created?.token ?? ''} className="font-mono" onFocus={(e) => e.target.select()} />
            <Button variant="outline" onClick={copy}><RiFileCopyLine /> Copy</Button>
          </div>
          <DialogFooter><Button onClick={() => setCreated(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmAction request={confirm} onClose={() => setConfirm(null)} />
    </Card>
  )
}

function ActivityCard() {
  const { isAdmin } = useAuth()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['activity'], queryFn: () => getActivity({ limit: 50 }) })
  const [confirm, setConfirm] = useState(null)
  const revert = useMutation({
    mutationFn: revertActivity,
    onSuccess: (r) => {
      toast.success(`Reverted ${plural(r.files_restored, 'file')}`)
      for (const k of ['activity', 'files', 'counts', 'folders']) qc.invalidateQueries({ queryKey: [k] })
    },
    onError: (e) => toast.error(e.message),
  })
  const items = data?.activity ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent activity</CardTitle>
        <CardDescription>Recent changes made through the Agent API. Reverting restores the affected files to how they were before.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-12 w-full" />}
        {data && items.length === 0 && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><RiHistoryLine /></EmptyMedia>
              <EmptyTitle>No agent activity yet</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
        {items.length > 0 && (
          <ul className="divide-y rounded-lg ring-1 ring-foreground/10">
            {items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <span className="font-medium">{a.agent_name || 'agent'}</span>{' '}
                    <code className="text-xs">{a.action}</code>{' '}
                    {a.file_count > 0 && <span className="text-muted-foreground">· {plural(a.file_count, 'file')}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{when(a.created_at)}</p>
                </div>
                {a.reverted_at ? (
                  <Badge variant="secondary">reverted</Badge>
                ) : a.revertable && isAdmin ? (
                  <Button variant="outline" size="sm"
                    onClick={() => setConfirm({
                      title: 'Revert this change?',
                      description: `${plural(a.file_count, 'file')} will go back to how ${a.file_count === 1 ? 'it was' : 'they were'} before. Later edits to the same files are overwritten.`,
                      confirmLabel: 'Revert',
                      onConfirm: () => revert.mutate(a.id),
                    })}><RiArrowGoBackLine /> Revert</Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmAction request={confirm} onClose={() => setConfirm(null)} />
    </Card>
  )
}

export default function AgentTab() {
  return (
    <div className="grid gap-4">
      <AgentDocs />
      <ConfirmationCard />
      <TokenCard />
      <ActivityCard />
    </div>
  )
}
