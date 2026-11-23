import { useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { bulkUpdateFiles, createGroup, getFiles, patchFile, trashFiles, ungroupGroup, updateGroup } from '@/api/client.js'

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

const isGroupCard = (f) => f.group_id != null && (f.group_size ?? 2) > 1

/**
 * Bulk file operations through POST /api/files/bulk, each with an Undo toast.
 * `files` are file objects (id, folder_id, tags, is_favorite) as returned by the list endpoint,
 * so the previous state is known and can be restored.
 */
export function useBulkActions({ groups = false } = {}) {
  const qc = useQueryClient()
  const lastUndo = useRef(null)

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['files'] })
    qc.invalidateQueries({ queryKey: ['folders'] })
    qc.invalidateQueries({ queryKey: ['counts'] })
    qc.invalidateQueries({ queryKey: ['file'] })
    qc.invalidateQueries({ queryKey: ['group'] })
  }, [qc])

  // With `groups`, a group card stands for all of its live clips: fetch them so every action (and its Undo)
  // works on the exact clips. The server gets expand_groups too. Returns { list, cards, unit }.
  const expand = useCallback(async (files) => {
    if (!groups || !files.some(isGroupCard)) return { list: files, cards: files.length, unit: 'file' }
    const seen = new Set()
    const list = []
    for (const f of files) {
      const members = isGroupCard(f)
        ? (await getFiles({ group: f.group_id, limit: 500 })).files.filter((m) => !m.deleted_at)
        : [f]
      for (const m of members) if (!seen.has(m.id)) { seen.add(m.id); list.push(m) }
    }
    return { list, cards: files.length, unit: 'clip' }
  }, [groups])
  const ex = groups ? { expand_groups: true } : {}

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

  const moveToFolder = useCallback(async (files, folderId, folderName) => {
    if (!files.length) return true
    const { list, unit } = await expand(files)
    const ids = list.map((f) => f.id)
    const prev = groupBy(list, (f) => f.folder_id ?? null)
    return run(
      `Moved ${plural(ids.length, unit)} to ${folderId == null ? 'Unfiled' : folderName || 'folder'}`,
      () => bulkUpdateFiles({ file_ids: ids, folder_id: folderId, ...ex }),
      () => Promise.all([...prev].map(([fid, fileIds]) => bulkUpdateFiles({ file_ids: fileIds, folder_id: fid }))),
    )
  }, [run, expand, groups]) // eslint-disable-line react-hooks/exhaustive-deps

  const addTag = useCallback(async (files, tag) => {
    const { list, unit } = await expand(files)
    const lacking = list.filter((f) => !f.tags?.some((t) => t.id === tag.id)).map((f) => f.id)
    if (!lacking.length) return true
    return run(
      `Added "${tag.name}" to ${plural(lacking.length, unit)}`,
      () => bulkUpdateFiles({ file_ids: lacking, add_tag_ids: [tag.id] }),
      () => bulkUpdateFiles({ file_ids: lacking, remove_tag_ids: [tag.id] }),
    )
  }, [run, expand])

  const removeTag = useCallback(async (files, tag) => {
    const { list, unit } = await expand(files)
    const having = list.filter((f) => f.tags?.some((t) => t.id === tag.id)).map((f) => f.id)
    if (!having.length) return true
    return run(
      `Removed "${tag.name}" from ${plural(having.length, unit)}`,
      () => bulkUpdateFiles({ file_ids: having, remove_tag_ids: [tag.id] }),
      () => bulkUpdateFiles({ file_ids: having, add_tag_ids: [tag.id] }),
    )
  }, [run, expand])

  const setFavorite = useCallback(async (files, value) => {
    const { list, unit } = await expand(files)
    const prev = groupBy(list, (f) => !!f.is_favorite)
    return run(
      value ? `Favorited ${plural(list.length, unit)}` : `Removed ${plural(list.length, 'favorite')}`,
      () => bulkUpdateFiles({ file_ids: list.map((f) => f.id), is_favorite: value, ...ex }),
      () => Promise.all([...prev].map(([fav, ids]) => bulkUpdateFiles({ file_ids: ids, is_favorite: fav }))),
    )
  }, [run, expand, groups]) // eslint-disable-line react-hooks/exhaustive-deps

  const markReviewed = useCallback(async (files) => {
    const { list, unit } = await expand(files)
    const ids = list.map((f) => f.id)
    return run(
      `Marked ${plural(ids.length, unit)} reviewed`,
      () => bulkUpdateFiles({ file_ids: ids, mark_reviewed: true, ...ex }),
      () => Promise.all(ids.map((id) => patchFile(id, { needs_tagging: 1 }))),
    )
  }, [run, expand, groups]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Soft delete: files go to the Trash (nothing is removed from disk) and the toast offers Undo. */
  const deleteFiles = useCallback(async (files) => {
    if (!files.length) return true
    const { list, unit } = await expand(files)
    const ids = list.map((f) => f.id)
    return run(
      `Moved ${plural(ids.length, unit)} to Trash`,
      () => trashFiles(ids, true, groups),
      () => trashFiles(ids, false),
    )
  }, [run, expand, groups])

  const restoreFiles = useCallback((files) => {
    if (!files.length) return Promise.resolve(true)
    const ids = files.map((f) => f.id)
    return run(
      `Restored ${plural(ids.length, 'file')}`,
      () => trashFiles(ids, false),
      () => trashFiles(ids, true),
    )
  }, [run])

  /** Make one group of the selected cards (group cards contribute all their clips). */
  const groupFiles = useCallback(async (files, title) => {
    const { list } = await expand(files)
    if (list.length < 2) { toast.error('Select at least two clips to group'); return false }
    let gid = null
    return run(
      `Grouped ${plural(list.length, 'clip')}`,
      async () => { gid = (await createGroup(list.map((f) => f.id), title)).id },
      () => ungroupGroup(gid),
    )
  }, [run, expand])

  /** Ungroup every group among `files` (group cards); Undo re-creates them with the same order and title. */
  const ungroupFiles = useCallback(async (files) => {
    const cards = files.filter(isGroupCard)
    if (!cards.length) return true
    const snaps = []
    for (const c of cards) {
      const members = (await getFiles({ group: c.group_id, limit: 500 })).files
      snaps.push({ gid: c.group_id, title: c.group_title, ids: members.map((m) => m.id), n: members.filter((m) => !m.deleted_at).length })
    }
    const clips = snaps.reduce((n, g) => n + g.n, 0)
    return run(
      `Ungrouped ${plural(clips, 'clip')}`,
      () => Promise.all(snaps.map((g) => ungroupGroup(g.gid))),
      () => Promise.all(snaps.map((g) => createGroup(g.ids, g.title))),
    )
  }, [run])

  const renameGroup = useCallback((gid, from, to) => run(
    `Renamed group to "${to}"`,
    () => updateGroup(gid, { title: to }),
    () => updateGroup(gid, { title: from }),
  ), [run])

  return { groupFiles, ungroupFiles, renameGroup, deleteFiles, restoreFiles, moveToFolder, addTag, removeTag, setFavorite, markReviewed, undoLast, refresh, run }
}
