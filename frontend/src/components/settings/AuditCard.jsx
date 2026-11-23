import React from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button.jsx'
import { Skeleton } from '@/components/ui/skeleton.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx'
import { getAudit } from '@/api/client.js'
import { absoluteTime, relativeTime } from '@/lib/people.js'

const ACTIONS = {
  login: 'Signed in',
  login_failed: 'Failed sign-in',
  logout: 'Signed out',
  login_enabled: 'Turned login on',
  login_disabled: 'Turned login off',
  user_created: 'Created a user',
  user_updated: 'Changed a user',
  user_disabled: 'Disabled a user',
  user_password_reset: 'Reset a password',
  password_changed: 'Changed own password',
  token_created: 'Created an API token',
  token_revoked: 'Revoked an API token',
  purge: 'Deleted files forever',
  activity_reverted: 'Reverted agent activity',
  settings_changed: 'Changed settings',
}
export const auditLabel = (a) => ACTIONS[a] ?? a.replaceAll('_', ' ')

// One short line from the detail object; the audit log never holds secrets.
function summary(e) {
  const d = e.detail
  if (!d) return ''
  const bits = []
  if (d.username && e.action !== 'login' && e.action !== 'logout') bits.push(`@${d.username}`)
  if (d.name) bits.push(`"${d.name}"`)
  if (d.role) bits.push(`role ${d.role}`)
  if (typeof d.disabled === 'boolean') bits.push(d.disabled ? 'disabled' : 'enabled')
  if (d.display_name) bits.push(`name "${d.display_name}"`)
  if (d.count != null) bits.push(`${d.count} file${d.count === 1 ? '' : 's'}`)
  if (d.reason) bits.push(String(d.reason))
  if (d.ip) bits.push(`from ${d.ip}`)
  if (d.setup) bits.push('first-run setup')
  if (!bits.length) {
    const rest = Object.entries(d).filter(([, v]) => v == null || typeof v !== 'object').map(([k, v]) => `${k} ${v}`)
    return rest.join(', ').slice(0, 120)
  }
  return bits.join(' · ')
}

export default function AuditCard() {
  const q = useInfiniteQuery({
    queryKey: ['audit'],
    queryFn: ({ pageParam }) => getAudit({ limit: 25, before: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.next_before ?? undefined,
  })
  const entries = q.data?.pages.flatMap((p) => p.entries) ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>Sign-ins, user changes, tokens, settings and permanent deletions, newest first.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {q.isLoading && <Skeleton className="h-24 w-full" />}
        {q.isError && <p role="alert" className="text-xs text-destructive">{q.error.message}</p>}
        {q.data && entries.length === 0 && <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>}
        {entries.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground" title={absoluteTime(e.created_at)}>{relativeTime(e.created_at)}</TableCell>
                  <TableCell className="whitespace-nowrap">{e.actor_label || (e.username ? `@${e.username}` : e.action === 'login_failed' ? 'Unknown' : 'System')}</TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="font-medium">{auditLabel(e.action)}</span>
                    {summary(e) && <span className="text-muted-foreground"> · {summary(e)}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {q.hasNextPage && (
          <div><Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage ? 'Loading…' : 'Load older entries'}</Button></div>
        )}
      </CardContent>
    </Card>
  )
}
