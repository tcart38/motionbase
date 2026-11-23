import React, { useState } from 'react'
import { RiKey2Line, RiLogoutBoxRLine, RiExpandUpDownLine } from '@remixicon/react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu.jsx'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import UserAvatar from '@/components/UserAvatar.jsx'
import ChangePasswordDialog from '@/components/account/ChangePasswordDialog.jsx'
import { useAuth } from '@/context/AuthContext.jsx'
import { useIsMobile } from '@/hooks/use-mobile.js'

/** Signed-in user at the bottom of the sidebar. Renders nothing while login is off. */
export default function UserMenu() {
  const { enabled, user, signOut } = useAuth()
  const isMobile = useIsMobile()
  const [pwOpen, setPwOpen] = useState(false)
  if (!enabled || !user) return null

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger render={<SidebarMenuButton size="lg" tooltip={user.display_name} aria-label={`Account menu for ${user.display_name}`} />}>
          <UserAvatar name={user.display_name} />
          <span className="grid min-w-0 flex-1 text-left leading-tight">
            <span className="truncate text-xs font-medium">{user.display_name}</span>
            <span className="truncate text-[0.625rem] text-muted-foreground">{user.role === 'admin' ? 'Administrator' : 'User'}</span>
          </span>
          <RiExpandUpDownLine className="ml-auto size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side={isMobile ? 'top' : 'right'} align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center gap-2 py-2">
              <UserAvatar name={user.display_name} size="lg" />
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-sm font-medium text-foreground">{user.display_name}</span>
                <span className="truncate text-xs text-muted-foreground">@{user.username}</span>
              </span>
              <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role}</Badge>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setPwOpen(true)}><RiKey2Line /> Change password</DropdownMenuItem>
          <DropdownMenuItem onClick={() => signOut()}><RiLogoutBoxRLine /> Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </SidebarMenuItem>
  )
}
