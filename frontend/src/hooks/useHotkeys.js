import { useEffect, useRef } from 'react'

const CHORD_TIMEOUT = 1000

const isTyping = (t) =>
  t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable=true], [role=menu], [role=listbox]')

const dialogOpen = () => !!document.querySelector('[role=dialog][data-open], [role=alertdialog][data-open], [role=dialog][data-state=open]')

/**
 * Global keyboard shortcuts.
 *
 * bindings: { 'mod+k': fn, '?': fn, 'g l': fn, ... }
 *  - 'mod+x' is Cmd on macOS and Ctrl elsewhere; it also works while typing in a field.
 *  - 'g l' is a two-key chord (second key within one second).
 *  - Plain keys and chords are ignored while typing, while a dialog is open, or with Ctrl/Cmd/Alt held.
 * Handlers receive the KeyboardEvent. Bindings may change between renders without re-subscribing.
 */
export function useHotkeys(bindings, { enabled = true } = {}) {
  const ref = useRef(bindings)
  ref.current = bindings

  useEffect(() => {
    if (!enabled) return undefined
    let pending = null // first key of a chord
    let timer = null
    const clear = () => { pending = null; clearTimeout(timer) }

    const onKey = (e) => {
      if (e.defaultPrevented || e.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
      const map = ref.current
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

      if (e.metaKey || e.ctrlKey) {
        const fn = !e.altKey && map[`mod+${key}`]
        if (fn) { e.preventDefault(); clear(); fn(e) }
        return
      }
      if (e.altKey || isTyping(e.target) || dialogOpen()) { clear(); return }

      if (pending) {
        const fn = map[`${pending} ${key}`]
        clear()
        if (fn) { e.preventDefault(); fn(e) }
        return
      }
      if (map[key]) { e.preventDefault(); map[key](e); return }
      if (Object.keys(map).some((b) => b.startsWith(`${key} `))) {
        pending = key
        timer = setTimeout(clear, CHORD_TIMEOUT)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); clear() }
  }, [enabled])
}
