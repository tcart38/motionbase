// Drag-and-drop of media onto folders (HTML5 DnD with a private MIME type).
export const FILES_MIME = 'application/x-motionbase-files'

// The payload carries just enough (id, folder_id) to move the files and to undo the move.
export function setDragFiles(e, files) {
  const slim = files.map((f) => ({ id: f.id, folder_id: f.folder_id ?? null }))
  e.dataTransfer.setData(FILES_MIME, JSON.stringify(slim))
  e.dataTransfer.setData('text/plain', `${slim.length} file${slim.length === 1 ? '' : 's'}`)
  e.dataTransfer.effectAllowed = 'move'
}

export function hasDragFiles(e) {
  return Array.from(e.dataTransfer?.types || []).includes(FILES_MIME)
}

export function getDragFiles(e) {
  try {
    const ids = JSON.parse(e.dataTransfer.getData(FILES_MIME))
    return Array.isArray(ids) ? ids.filter((f) => Number.isInteger(f?.id)) : []
  } catch {
    return []
  }
}
