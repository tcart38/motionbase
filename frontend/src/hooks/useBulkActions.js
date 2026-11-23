import { useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { bulkUpdateFiles, patchFile, trashFiles } from '@/api/client.js'

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

function groupBy(files, keyFn) {
  const m = new Map()
  for (const f of files) {
    const k = keyFn(f)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(f.id)
  }
  return m
}

/**
 * Bulk file operations through POST /api/files/bulk, each with an Undo toast.
 * `files` are file objects (id, folder_id, tags, is_favorite) as returned by the list endpoint,
 * so the previous state is known and can be restored.
 */
export function useBulkActions() {
  const qc = useQueryClient()
  const lastUndo = useRef(null)

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['files'] })
    qc.invalidateQueries({ queryKey: ['folders'] })
    qc.invalidateQueries({ queryKey: ['counts'] })
    qc.invalidateQueries({ queryKey: ['file'] })
  }, [qc])

  // apply: () => Promise; undo: () => Promise
  const run = useCallback(async (message, apply, undo) => {
    try {
      await apply()
    } catch (err) {
      toast.error(err.message)
      return false
    }
    refresh()
    const doUndo = async () => {
      if (lastUndo.current === doUndo) lastUndo.current = null
      try { await undo(); refresh(); toast.info('Undone') } catch (err) { toast.error(err.message) }
    }
    lastUndo.current = undo ? doUndo : null
    toast.success(message, undo ? { action: { label: 'Undo', onClick: doUndo } } : undefined)
    return true
  }, [refresh])

  /** Undo the most recent action from this hook (keyboard shortcut). Returns false when there is nothing to undo. */
  const undoLast = useCallback(async () => {
    const fn = lastUndo.current
    if (!fn) return false
    await fn()
    return true
  }, [])

  const moveToFolder = useCallback((files, folderId, folderName) => {
    if (!files.length) return Promise.resolve(true)
    const ids = files.map((f) => f.id)
    const prev = groupBy(files, (f) => f.folder_id ?? null)
    return run(
      `Moved ${plural(ids.length, 'file')} to ${folderId == null ? 'Unfiled' : folderName || 'folder'}`,
      () => bulkUpdateFiles({ file_ids: ids, folder_id: folderId }),
      () => Promise.all([...prev].map(([fid, fileIds]) => bulkUpdateFiles({ file_ids: fileIds, folder_id: fid }))),
    )
  }, [run])

  const addTag = useCallback((files, tag) => {
    const lacking = files.filter((f) => !f.tags?.some((t) => t.id === tag.id)).map((f) => f.id)
    if (!lacking.length) return Promise.resolve(true)
    return run(
      `Added "${tag.name}" to ${plural(lacking.length, 'file')}`,
      () => bulkUpdateFiles({ file_ids: lacking, add_tag_ids: [tag.id] }),
      () => bulkUpdateFiles({ file_ids: lacking, remove_tag_ids: [tag.id] }),
    )
  }, [run])

  const removeTag = useCallback((files, tag) => {
    const having = files.filter((f) => f.tags?.some((t) => t.id === tag.id)).map((f) => f.id)
    if (!having.length) return Promise.resolve(true)
    return run(
      `Removed "${tag.name}" from ${plural(having.length, 'file')}`,
      () => bulkUpdateFiles({ file_ids: having, remove_tag_ids: [tag.id] }),
      () => bulkUpdateFiles({ file_ids: having, add_tag_ids: [tag.id] }),
    )
  }, [run])

  const setFavorite = useCallback((files, value) => {
    const prev = groupBy(files, (f) => !!f.is_favorite)
    return run(
      value ? `Favorited ${plural(files.length, 'file')}` : `Removed ${plural(files.length, 'favorite')}`,
      () => bulkUpdateFiles({ file_ids: files.map((f) => f.id), is_favorite: value }),
      () => Promise.all([...prev].map(([fav, ids]) => bulkUpdateFiles({ file_ids: ids, is_favorite: fav }))),
    )
  }, [run])

  const markReviewed = useCallback((files) => {
    const ids = files.map((f) => f.id)
    return run(
      `Marked ${plural(ids.length, 'file')} reviewed`,
      () => bulkUpdateFiles({ file_ids: ids, mark_reviewed: true }),
      () => Promise.all(ids.map((id) => patchFile(id, { needs_tagging: 1 }))),
    )
  }, [run])

  /** Soft delete: files go to the Trash (nothing is removed from disk) and the toast offers Undo. */
  const deleteFiles = useCallback((files) => {
    if (!files.length) return Promise.resolve(true)
    const ids = files.map((f) => f.id)
    return run(
      `Moved ${plural(ids.length, 'file')} to Trash`,
      () => trashFiles(ids, true),
      () => trashFiles(ids, false),
    )
  }, [run])

  const restoreFiles = useCallback((files) => {
    if (!files.length) return Promise.resolve(true)
    const ids = files.map((f) => f.id)
    return run(
      `Restored ${plural(ids.length, 'file')}`,
      () => trashFiles(ids, false),
      () => trashFiles(ids, true),
    )
  }, [run])

  return { deleteFiles, restoreFiles, moveToFolder, addTag, removeTag, setFavorite, markReviewed, undoLast, refresh }
}
