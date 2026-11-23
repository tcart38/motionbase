import React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog.jsx'
import { Kbd, KbdGroup } from '@/components/ui/kbd.jsx'
import { ScrollArea } from '@/components/ui/scroll-area.jsx'
import { SHORTCUT_SECTIONS, keyLabel } from '@/lib/shortcuts.js'

export function Keys({ keys }) {
  return (
    <KbdGroup>
      {keys.map((k, i) => <Kbd key={i}>{keyLabel(k)}</Kbd>)}
    </KbdGroup>
  )
}

/** The "?" cheat sheet. */
export default function ShortcutsDialog({ open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts are paused while you type in a field.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="grid gap-5 pb-1">
            {SHORTCUT_SECTIONS.map((s) => (
              <section key={s.title} aria-labelledby={`sc-${s.title}`}>
                <h3 id={`sc-${s.title}`} className="mb-1.5 text-xs font-semibold text-muted-foreground">{s.title}</h3>
                <ul className="grid gap-1">
                  {s.items.map((it) => (
                    <li key={it.label} className="flex items-center justify-between gap-3 text-xs/relaxed">
                      <span>{it.label}</span>
                      <Keys keys={it.keys} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
