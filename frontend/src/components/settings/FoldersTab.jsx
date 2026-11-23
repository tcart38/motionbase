import React, { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  RiFolderLine, RiFolderAddLine, RiPencilLine, RiDeleteBinLine, RiFolderTransferLine, RiHardDriveLine,
} from '@remixicon/react'
import { importFoldersFromDisk } from '@/api/client.js'
import { useAuth } from '@/context/AuthContext.jsx'
import { useFolders, useFolderMutations } from '@/hooks/useFolders.js'
import { buildTree, flattenTree, descendantIds } from '@/lib/folders.js'
import { Button } from '@/components/ui/button.jsx'
import { Skeleton } from '@/components/ui/skeleton.jsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import FolderDialog from '@/components/FolderDialog.jsx'
import MoveToFolderDialog from '@/components/MoveToFolderDialog.jsx'
import ConfirmAction from '@/components/ConfirmAction.jsx'

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

export default function FoldersTab() {
  const { data, isLoading } = useFolders()
  const { update, remove } = useFolderMutations()
  const qc = useQueryClient()
  const { isAdmin } = useAuth()
  const [dialog, setDialog] = useState(null) // { type, folder?, parent? }
  const [confirm, setConfirm] = useState(null)
  const folders = data?.folders ?? []
  const rows = useMemo(() => flattenTree(buildTree(folders)), [folders])

  const importDisk = useMutation({
    mutationFn: importFoldersFromDisk,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['folders'] }); qc.invalidateQueries({ queryKey: ['files'] })
      toast.success(`Created ${plural(r.folders_created, 'folder')}, filed ${plural(r.files_assigned, 'file')}`)
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Folders</CardTitle>
          <CardDescription>
            Folders are virtual and live only in the database; your media folder is never rearranged.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setDialog({ type: 'create' })}><RiFolderAddLine /> New folder</Button>
            {isAdmin && (
              <Button variant="outline" disabled={importDisk.isPending} onClick={() => importDisk.mutate({})}>
                <RiHardDriveLine /> {importDisk.isPending ? 'Importing…' : 'Import from disk structure'}
              </Button>
            )}
          </div>
          {isAdmin && (
            <p className="text-xs text-muted-foreground">
              Importing mirrors sub-directories of the media folder into folders and files any unfiled media there.
            </p>
          )}
        </CardContent>
      </Card>

      {isLoading && <Skeleton className="h-24 w-full" />}
      {data && rows.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><RiFolderLine /></EmptyMedia>
            <EmptyTitle>No folders yet</EmptyTitle>
            <EmptyDescription>Create one, or import your existing directory layout.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {rows.length > 0 && (
        <ul className="divide-y rounded-lg ring-1 ring-foreground/10">
          {rows.map((f) => (
            <li key={f.id} className="flex items-center gap-2 py-1.5 pr-1.5" style={{ paddingLeft: 12 + f.depth * 16 }}>
              <RiFolderLine className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{plural(f.total_count ?? f.file_count ?? 0, 'file')}</span>
              <Button variant="ghost" size="icon-sm" aria-label={`New subfolder in ${f.name}`} onClick={() => setDialog({ type: 'create', parent: f })}><RiFolderAddLine /></Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Rename ${f.name}`} onClick={() => setDialog({ type: 'rename', folder: f })}><RiPencilLine /></Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Move ${f.name}`} onClick={() => setDialog({ type: 'move', folder: f })}><RiFolderTransferLine /></Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Delete ${f.name}`}
                onClick={() => setConfirm({
                  title: `Delete "${f.name}"?`,
                  description: 'Media is never deleted. Subfolders and files move up one level.',
                  confirmLabel: 'Delete folder',
                  onConfirm: () => remove.mutate(f.id),
                })}><RiDeleteBinLine /></Button>
            </li>
          ))}
        </ul>
      )}

      <FolderDialog
        open={dialog?.type === 'create' || dialog?.type === 'rename'}
        onOpenChange={(o) => !o && setDialog(null)}
        mode={dialog?.type === 'rename' ? 'rename' : 'create'}
        folder={dialog?.folder}
        parentId={dialog?.parent?.id ?? null}
        parentName={dialog?.parent?.name}
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
      <ConfirmAction request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}
