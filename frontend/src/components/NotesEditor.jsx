import React, { useCallback, useEffect, useRef, useState } from 'react'
import { RiCheckLine } from '@remixicon/react'
import { toast } from 'sonner'
import { Textarea } from '@/components/ui/textarea.jsx'
import { patchFile } from '@/api/client.js'

export function SaveIndicator({ state }) {
  if (state === 'saving') return <span className="text-xs text-muted-foreground" role="status">Saving…</span>
  if (state === 'saved') return <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400" role="status"><RiCheckLine className="size-3" /> Saved</span>
  return null
}

/** Notes textarea that autosaves 800 ms after typing stops (and on blur). */
export default function NotesEditor({ file, onSaved }) {
  const [value, setValue] = useState(file.notes || '')
  const [state, setState] = useState('idle')
  const timer = useRef(null)
  const latest = useRef({ id: file.id, value, saved: file.notes || '' })
  latest.current.id = file.id

  useEffect(() => {
    setValue(file.notes || '')
    latest.current = { id: file.id, value: file.notes || '', saved: file.notes || '' }
    setState('idle')
  }, [file.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    clearTimeout(timer.current)
    const { id, value: v, saved } = latest.current
    if (v === saved) return
    setState('saving')
    try {
      const updated = await patchFile(id, { notes: v })
      latest.current.saved = v
      onSaved(updated)
      setState('saved')
      setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 1500)
    } catch (err) {
      toast.error(`Could not save notes: ${err.message}`)
      setState('idle')
    }
  }, [onSaved])

  useEffect(() => () => { save() }, [save])

  return (
    <div className="flex h-full flex-col gap-2">
      <Textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          latest.current.value = e.target.value
          clearTimeout(timer.current)
          timer.current = setTimeout(save, 800)
        }}
        onBlur={save}
        placeholder="Notes about this clip: what it shows, techniques, where it could be used…"
        aria-label="Notes"
        className="min-h-40 flex-1 resize-none leading-relaxed"
      />
      <div className="h-4"><SaveIndicator state={state} /></div>
    </div>
  )
}

