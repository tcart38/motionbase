import React, { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  RiAddLine, RiArrowRightSLine, RiFolderLine, RiFolderOpenLine, RiInboxUnarchiveLine, RiMoreLine,
  RiPencilLine, RiFolderAddLine, RiDeleteBinLine, RiFolderTransferLine,
} from '@remixicon/react'
import {
  SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarMenu,
  SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton,
} from '@/components/ui/sidebar.jsx'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu.jsx'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.jsx'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog.jsx'
import { useFolders, useFolderMutations } from '@/hooks/useFolders.js'
import { useBulkActions } from '@/hooks/useBulkActions.js'
import { buildTree, descendantIds } from '@/lib/folders.js'
import { getDragFiles, hasDragFiles } from '@/lib/dnd.js'
import FolderDialog from './FolderDialog.jsx'
import MoveToFolderDialog from './MoveToFolderDialog.jsx'

const EXPANDED_KEY = 'folders:expanded'
const INDENT = 12

function loadExpanded() {
  try { return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]')) } catch { return new Set() }
}

const ACTIONS = [
  { key: 'subfolder', label: 'New subfolder', icon: RiFolderAddLine },
  { key: 'rename', label: 'Rename', icon: RiPencilLine },
  { key: 'move', label: 'Move to…', icon: RiFolderTransferLine },
  { key: 'delete', label: 'Delete', icon: RiDeleteBinLine, destructive: true },
]

/** Sidebar folder tree: Unfiled + nested folders, context menu, and drop targets for dragged media. */
export default function FolderTree() {
  const { data, isLoading } = useFolders()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { update, remove } = useFolderMutations()
  const { moveToFolder } = useBulkActions({ groups: true })

  const [expanded, setExpanded] = useState(loadExpanded)
  const [dropTarget, setDropTarget] = useState(undefined) // folder id | 'none'
  const [dialog, setDialog] = useState(null) // { type: 'create'|'rename'|'move'|'delete', folder?, parent? }

  const folders = data?.folders ?? []
  const tree = useMemo(() => buildTree(folders), [folders])
  const activeFolder = pathname === '/library' ? params.get('folder') : null

  const toggle = (id) => setExpanded((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
    return next
  })

  const go = (folder) => navigate(`/library?folder=${folder}`)

  const onAction = (key, folder) => {
    if (key === 'subfolder') {
      setExpanded((p) => new Set(p).add(folder.id))
      setDialog({ type: 'create', parent: folder })
    } else setDialog({ type: key, folder })
  }

  // Drop handlers shared by every row
  const dropProps = (target, folderId, name) => ({
    onDragOver: (e) => { if (hasDragFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTarget(target) } },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget((t) => (t === target ? undefined : t)) },
    onDrop: async (e) => {
      setDropTarget(undefined)
      const files = getDragFiles(e)
      if (!files.length) return
      e.preventDefault()
      moveToFolder(files.filter((f) => f.folder_id !== folderId), folderId, name)
    },
  })

  const renderNode = (node, depth) => {
    const hasChildren = node.children.length > 0
    const open = expanded.has(node.id)
    const active = activeFolder === String(node.id)
    return (
      <React.Fragment key={node.id}>
        <ContextMenu>
          <ContextMenuTrigger render={<li className="group/menu-item relative list-none" />}>
            <div {...dropProps(node.id, node.id, node.name)} className="relative">
              <SidebarMenuButton
                isActive={active}
                render={<Link to={`/library?folder=${node.id}`} />}
                style={{ paddingLeft: 8 + depth * INDENT + 18 }}
                className={dropTarget === node.id ? 'bg-primary/15 ring-2 ring-primary/50' : ''}
                title={node.name}
              >
                {open && hasChildren ? <RiFolderOpenLine /> : <RiFolderLine />}
                <span>{node.name}</span>
              </SidebarMenuButton>
              {hasChildren && (
                <button
                  type="button"
                  onClick={() => toggle(node.id)}
                  aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}
                  aria-expanded={open}
                  style={{ left: 4 + depth * INDENT }}
                  className="absolute top-1.5 flex size-5 items-center justify-center rounded text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden"
                >
                  <RiArrowRightSLine className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>
              )}
              <SidebarMenuBadge className="transition-opacity group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0">
                {node.total_count}
              </SidebarMenuBadge>
              <DropdownMenu>
                <DropdownMenuTrigger render={<SidebarMenuAction showOnHover aria-label={`Actions for ${node.name}`} />}>
                  <RiMoreLine />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start">
                  {ACTIONS.map((a, i) => (
                    <React.Fragment key={a.key}>
                      {a.destructive && <DropdownMenuSeparator />}
                      <DropdownMenuItem variant={a.destructive ? 'destructive' : undefined} onClick={() => onAction(a.key, node)}>
                        <a.icon /> {a.label}
                      </DropdownMenuItem>
                    </React.Fragment>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {ACTIONS.map((a) => (
              <React.Fragment key={a.key}>
                {a.destructive && <ContextMenuSeparator />}
                <ContextMenuItem variant={a.destructive ? 'destructive' : undefined} onClick={() => onAction(a.key, node)}>
                  <a.icon /> {a.label}
                </ContextMenuItem>
              </React.Fragment>
            ))}
          </ContextMenuContent>
        </ContextMenu>
        {hasChildren && open && node.children.map((c) => renderNode(c, depth + 1))}
      </React.Fragment>
    )
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Folders</SidebarGroupLabel>
      <SidebarGroupAction title="New folder" aria-label="New folder" onClick={() => setDialog({ type: 'create', parent: null })}>
        <RiAddLine />
      </SidebarGroupAction>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <div {...dropProps('none', null, null)}>
              <SidebarMenuButton
                isActive={activeFolder === 'none'}
                render={<Link to="/library?folder=none" />}
                className={dropTarget === 'none' ? 'bg-primary/15 ring-2 ring-primary/50' : ''}
              >
                <RiInboxUnarchiveLine />
                <span>Unfiled</span>
              </SidebarMenuButton>
              {data && <SidebarMenuBadge>{data.unfiled_count}</SidebarMenuBadge>}
            </div>
          </SidebarMenuItem>
          {isLoading && [0, 1].map((i) => <SidebarMenuItem key={i}><SidebarMenuSkeleton /></SidebarMenuItem>)}
          {tree.map((n) => renderNode(n, 0))}
          {data && tree.length === 0 && (
            <li className="px-2 py-1 text-xs text-sidebar-foreground/60">
              No folders yet. Use + to create one, then drag media onto it.
            </li>
          )}
        </SidebarMenu>
      </SidebarGroupContent>

      <FolderDialog
        open={dialog?.type === 'create' || dialog?.type === 'rename'}
        onOpenChange={(o) => !o && setDialog(null)}
        mode={dialog?.type === 'rename' ? 'rename' : 'create'}
        folder={dialog?.folder}
        parentId={dialog?.parent?.id ?? null}
        parentName={dialog?.parent?.name}
        onDone={(f) => { if (dialog?.type === 'create') go(f.id) }}
      />

      <MoveToFolderDialog
        open={dialog?.type === 'move'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Move "${dialog?.folder?.name ?? ''}"`}
        description="Choose a new parent folder."
        rootLabel="Top level"
        excludeIds={dialog?.folder ? descendantIds(folders, dialog.folder.id) : undefined}
        onSelect={(parentId) => update.mutate({ id: dialog.folder.id, parent_id: parentId })}
      />

      <AlertDialog open={dialog?.type === 'delete'} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{dialog?.folder?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Media is never deleted. Subfolders and files move up one level.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const id = dialog.folder.id
                remove.mutate(id, { onSuccess: () => { if (activeFolder === String(id)) navigate('/library') } })
              }}
            >
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarGroup>
  )
}
