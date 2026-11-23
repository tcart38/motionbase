import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getFolders, createFolder, updateFolder, deleteFolder } from '@/api/client.js'

export function useFolders() {
  return useQuery({ queryKey: ['folders'], queryFn: getFolders })
}

/** Folder mutations; each refreshes folder counts and any file lists (file folder_id may change). */
export function useFolderMutations() {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['folders'] })
    qc.invalidateQueries({ queryKey: ['files'] })
  }
  const onError = (err) => toast.error(err.message)
  return {
    create: useMutation({ mutationFn: createFolder, onSuccess: refresh, onError }),
    update: useMutation({ mutationFn: ({ id, ...body }) => updateFolder(id, body), onSuccess: refresh, onError }),
    remove: useMutation({ mutationFn: deleteFolder, onSuccess: refresh, onError }),
  }
}
