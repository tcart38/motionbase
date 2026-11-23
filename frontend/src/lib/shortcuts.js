// Single source of truth for the shortcuts that are shown in the palette and the "?" dialog.
// Bindings themselves are registered where they act (useHotkeys here, page handlers elsewhere).

export const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')

/** Render a key token for display: 'mod' becomes Cmd or Ctrl. */
export const keyLabel = (k) => ({
  mod: isMac ? '⌘' : 'Ctrl', space: 'Space', esc: 'Esc', left: '←', right: '→', shift: 'Shift',
}[k] ?? k)

export const SHORTCUT_SECTIONS = [
  {
    title: 'Global',
    items: [
      { keys: ['mod', 'k'], label: 'Open the command palette' },
      { keys: ['?'], label: 'Show keyboard shortcuts' },
      { keys: ['g', 'l'], label: 'Go to Library' },
      { keys: ['g', 'i'], label: 'Go to Inbox' },
      { keys: ['g', 'a'], label: 'Go to Add Media' },
      { keys: ['g', 's'], label: 'Go to Settings' },
    ],
  },
  {
    title: 'Library',
    items: [
      { keys: ['Click'], label: 'Open a file; Shift-click selects a range' },
      { keys: ['esc'], label: 'Clear the selection' },
    ],
  },
  {
    title: 'Inbox',
    items: [
      { keys: ['j'], label: 'Next file' },
      { keys: ['k'], label: 'Previous file' },
      { keys: ['e'], label: 'Confirm and go to the next (also a)' },
      { keys: ['s'], label: 'Skip' },
      { keys: ['z'], label: 'Undo' },
      { keys: ['t'], label: 'Quick tag' },
      { keys: ['m'], label: 'Move to folder' },
      { keys: ['1…9'], label: 'Toggle one of the first nine tags' },
    ],
  },
  {
    title: 'Player',
    items: [
      { keys: ['space'], label: 'Play or pause (also k)' },
      { keys: ['left'], label: 'Back 5 seconds (Shift: 1 second)' },
      { keys: ['right'], label: 'Forward 5 seconds (Shift: 1 second)' },
      { keys: ['PgUp', ','], label: 'Previous frame' },
      { keys: ['PgDn', '.'], label: 'Next frame' },
      { keys: ['['], label: 'Slower' },
      { keys: [']'], label: 'Faster' },
      { keys: ['m'], label: 'Mute' },
      { keys: ['f'], label: 'Fullscreen' },
      { keys: ['l'], label: 'Loop' },
    ],
  },
]
