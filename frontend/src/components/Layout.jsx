import React, { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  RiFilmLine, RiInboxLine, RiAddCircleLine, RiSettings3Line, RiDeleteBinLine, RiRefreshLine, RiSearchLine, RiKeyboardLine,
} from '@remixicon/react'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from '@/components/ui/sidebar.jsx'
import FolderTree from '@/components/FolderTree.jsx'
import CommandPalette from '@/components/CommandPalette.jsx'
import ShortcutsDialog from '@/components/ShortcutsDialog.jsx'
import { useHotkeys } from '@/hooks/useHotkeys.js'
import { useScan } from '@/hooks/useScan.js'
import UserMenu from '@/components/account/UserMenu.jsx'
import { useFileCounts } from '@/hooks/useInboxCount.js'

const navItems = [
  { to: '/library', icon: RiFilmLine, label: 'Library', total: true },
  { to: '/inbox', icon: RiInboxLine, label: 'Inbox', badge: true },
  { to: '/add-media', icon: RiAddCircleLine, label: 'Add Media' },
  { to: '/trash', icon: RiDeleteBinLine, label: 'Trash', trash: true },
  { to: '/settings', icon: RiSettings3Line, label: 'Settings' },
]

export default function Layout() {
  const { scanning, scan } = useScan()
  const { data: counts } = useFileCounts()
  const inboxCount = counts?.inbox ?? 0
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  useHotkeys({
    'mod+k': () => setPaletteOpen((o) => !o),
    '?': () => setShortcutsOpen(true),
    'g l': () => navigate('/library'),
    'g i': () => navigate('/inbox'),
    'g a': () => navigate('/add-media'),
    'g t': () => navigate('/trash'),
    'g s': () => navigate('/settings'),
  })
  const inFolder = pathname === '/library' && params.has('folder')

  return (
    <SidebarProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:justify-center">
            <span className="px-2 py-1.5 text-base font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
              MotionBase
            </span>
            <SidebarTrigger className="hidden md:inline-flex" />
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map(({ to, icon: Icon, label, badge, total, trash }) => (
                  <SidebarMenuItem key={to}>
                    <SidebarMenuButton
                      tooltip={label}
                      isActive={(pathname === to || pathname.startsWith(`${to}/`)) && !(total && inFolder)}
                      render={<NavLink to={to} />}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                    {total && counts && (
                      <SidebarMenuBadge aria-label={`${counts.total} files`}>{counts.total}</SidebarMenuBadge>
                    )}
                    {trash && counts?.trash > 0 && (
                      <SidebarMenuBadge aria-label={`${counts.trash} in trash`}>{counts.trash}</SidebarMenuBadge>
                    )}
                    {badge && inboxCount > 0 && (
                      <SidebarMenuBadge aria-label={`${inboxCount} to review`}>
                        {inboxCount > 99 ? '99+' : inboxCount}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <FolderTree />
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Search and commands" onClick={() => setPaletteOpen(true)}>
                <RiSearchLine />
                <span>Search…</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}>
                <RiKeyboardLine />
                <span>Shortcuts</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Scan now" onClick={scan} disabled={scanning}>
                <RiRefreshLine className={scanning ? 'animate-spin' : ''} />
                <span>{scanning ? 'Scanning…' : 'Scan Now'}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <UserMenu />
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 h-svh overflow-hidden">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3 md:hidden">
          <SidebarTrigger />
          <span className="text-sm font-semibold">MotionBase</span>
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 min-h-0 overflow-y-auto outline-none">
          <Outlet />
        </main>
      </SidebarInset>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onScan={scan}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </SidebarProvider>
  )
}
