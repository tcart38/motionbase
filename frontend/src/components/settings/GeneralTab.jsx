import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getSettings, updateSettings, getCookiesStatus, saveCookies, deleteCookies } from '@/api/client.js'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Textarea } from '@/components/ui/textarea.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'

function ScanCard({ settings }) {
  const qc = useQueryClient()
  const [interval, setInterval_] = useState('30')
  useEffect(() => { if (settings) setInterval_(settings.scan_interval || '30') }, [settings])
  const save = useMutation({
    mutationFn: () => updateSettings({ scan_interval: interval }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('Scan interval saved') },
    onError: (e) => toast.error(e.message),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Scanning</CardTitle>
        <CardDescription>How often MotionBase looks for new files in the media folder.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="scan-interval">Auto-scan interval (minutes)</Label>
            <Input id="scan-interval" type="number" min="0" className="w-28" value={interval}
              onChange={(e) => setInterval_(e.target.value)} />
          </div>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
          <p className="basis-full text-xs text-muted-foreground">0 disables automatic scanning.</p>
        </form>
      </CardContent>
    </Card>
  )
}

function CookiesCard() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['cookies'], queryFn: getCookiesStatus })
  const [content, setContent] = useState('')
  const done = (msg) => { qc.invalidateQueries({ queryKey: ['cookies'] }); toast.success(msg) }
  const save = useMutation({
    mutationFn: () => saveCookies(content),
    onSuccess: () => { setContent(''); done('Cookies saved') },
    onError: (e) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: deleteCookies, onSuccess: () => done('Cookies removed'), onError: (e) => toast.error(e.message),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          URL import cookies
          {data && <Badge variant={data.hasCookies ? 'default' : 'secondary'}>{data.hasCookies ? 'Set' : 'Not set'}</Badge>}
        </CardTitle>
        <CardDescription>
          Paste a Netscape-format cookies.txt so yt-dlp can download videos that need you to be signed in.
          The file is stored in the data folder and never shown again.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Label htmlFor="cookies-content" className="sr-only">cookies.txt contents</Label>
        <Textarea id="cookies-content" rows={4} className="font-mono" placeholder="# Netscape HTTP Cookie File"
          value={content} onChange={(e) => setContent(e.target.value)} />
        <div className="flex gap-2">
          <Button onClick={() => save.mutate()} disabled={!content.trim() || save.isPending}>Save cookies</Button>
          {data?.hasCookies && <Button variant="outline" onClick={() => remove.mutate()}>Remove</Button>}
        </div>
      </CardContent>
    </Card>
  )
}

export default function GeneralTab() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  return (
    <div className="grid gap-4">
      <ScanCard settings={settings} />
      <CookiesCard />
      <p className="text-xs text-muted-foreground">MotionBase {settings?.version ? `v${settings.version}` : ''}</p>
    </div>
  )
}
