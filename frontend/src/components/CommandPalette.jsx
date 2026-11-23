import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  RiFilmLine, RiInboxLine, RiAddCircleLine, RiSettings3Line, RiFolderLine, RiPriceTag3Line,
  RiRefreshLine, RiKeyboardLine, RiContrast2Line, RiHeartLine, RiPlayLine,
} from '@remixicon/react'
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command.jsx'
import { getFiles } from '@/api/client.js'
import { useFolders } from '@/hooks/useFolders.js'
import { useTaxonomy } from '@/hooks/useTaxonomy.js'
import { useTheme } from '@/context/ThemeContext.jsx'
import { folderPath } from '@/lib/folders.js'
import { Keys } from './ShortcutsDialog.jsx'

/** Cmd/Ctrl-K: jump to pages, folders and tags, search files, run actions. */
export default function CommandPalette({ open, onOpenChange, onScan, onShowShortcuts }) {
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const { data: folderData } = useFolders()
  const { groups } = useTaxonomy()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => { if (!open) setQuery('') }, [open])
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200)
    return () => clearTimeout(t)
  }, [query])

  const { data: found } = useQuery({
    queryKey: ['files', 'palette', debounced],
    queryFn: () => getFiles({ search: debounced, limit: 6 }),
    enabled: open && debounced.length >= 2,
  })
  const fileResults = found?.files ?? []

  const run = (fn) => () => { onOpenChange(false); fn() }
  const go = (to) => run(() => navigate(to))
  const folders = folderData?.folders ?? []
  const tags = groups.filter((g) => !g.is_system).flatMap((g) => g.tags.map((t) => ({ ...t, category: g.name })))

  const nextTheme = theme === 'dark' ? 'light' : 'dark'

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette" description="Search pages, folders, tags and files, or run an action">
      <CommandInput placeholder="Type a command or search…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Go to">
          <CommandItem onSelect={go('/library')}><RiFilmLine /> Library <CommandShortcut><Keys keys={['g', 'l']} /></CommandShortcut></CommandItem>
          <CommandItem onSelect={go('/inbox')}><RiInboxLine /> Inbox <CommandShortcut><Keys keys={['g', 'i']} /></CommandShortcut></CommandItem>
          <CommandItem onSelect={go('/add-media')}><RiAddCircleLine /> Add Media <CommandShortcut><Keys keys={['g', 'a']} /></CommandShortcut></CommandItem>
          <CommandItem onSelect={go('/settings')}><RiSettings3Line /> Settings <CommandShortcut><Keys keys={['g', 's']} /></CommandShortcut></CommandItem>
          <CommandItem onSelect={go('/library?favorites=1')}><RiHeartLine /> Favorites</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem onSelect={run(onScan)}><RiRefreshLine /> Scan library now</CommandItem>
          <CommandItem onSelect={run(() => setTheme(nextTheme))}><RiContrast2Line /> Switch to {nextTheme} theme</CommandItem>
          <CommandItem onSelect={run(onShowShortcuts)}><RiKeyboardLine /> Keyboard shortcuts <CommandShortcut><Keys keys={['?']} /></CommandShortcut></CommandItem>
        </CommandGroup>
        {fileResults.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Files">
              {fileResults.map((f) => (
                <CommandItem key={f.id} value={`file ${f.id} ${f.filename}`} onSelect={go(`/player/${f.id}`)}>
                  <RiPlayLine /> <span className="truncate">{f.filename}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {folders.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Folders">
              {folders.map((f) => {
                const path = folderPath(folders, f.id).join(' / ')
                return <CommandItem key={f.id} value={`folder ${path}`} onSelect={go(`/library?folder=${f.id}`)}><RiFolderLine /> {path}</CommandItem>
              })}
            </CommandGroup>
          </>
        )}
        {tags.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Filter library by tag">
              {tags.map((t) => (
                <CommandItem key={t.id} value={`tag ${t.category} ${t.name}`} onSelect={go(`/library?tags=${t.id}`)}>
                  <RiPriceTag3Line /> {t.name} <CommandShortcut>{t.category}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
