const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

// Files
export const getFiles = (params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''))
  ).toString()
  return request(`/files${qs ? `?${qs}` : ''}`)
}
export const getFile = (id) => request(`/files/${id}`)
export const getNextFile = (id, params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''))
  ).toString()
  return request(`/files/${id}/next${qs ? `?${qs}` : ''}`)
}
export const patchFile = (id, body) => request(`/files/${id}`, { method: 'PATCH', body })
export const deleteFile = (id) => request(`/files/${id}`, { method: 'DELETE' })

export const getFileCounts = () => request('/files/counts')
export const trashFiles = (file_ids, deleted = true) => request('/files/trash', { method: 'POST', body: { file_ids, deleted } })
export const purgeFiles = (body) => request('/files/purge', { method: 'POST', body })
export const bulkUpdateFiles = (body) => request('/files/bulk', { method: 'POST', body })

// Folders
export const getFolders = () => request('/folders')
export const createFolder = (body) => request('/folders', { method: 'POST', body })
export const updateFolder = (id, body) => request(`/folders/${id}`, { method: 'PATCH', body })
export const deleteFolder = (id) => request(`/folders/${id}`, { method: 'DELETE' })
export const importFoldersFromDisk = (body = {}) => request('/folders/import-from-disk', { method: 'POST', body })

// Import
export const importUrl = (url) => request('/import', { method: 'POST', body: { url } })

// Scan
export const triggerScan = () => request('/scan', { method: 'POST' })
export const getScanStatus = () => request('/scan/status')

// Tags
export const getTags = () => request('/tags')
export const createTag = (body) => request('/tags', { method: 'POST', body })
export const updateTag = (id, body) => request(`/tags/${id}`, { method: 'PATCH', body })
export const deleteTagPreview = (id) => request(`/tags/${id}/delete-preview`)
export const deleteTag = (id) => request(`/tags/${id}`, { method: 'DELETE' })

// Categories
export const getCategories = () => request('/categories')
export const createCategory = (body) => request('/categories', { method: 'POST', body })
export const updateCategory = (id, body) => request(`/categories/${id}`, { method: 'PATCH', body })
export const deleteCategoryPreview = (id) => request(`/categories/${id}/delete-preview`)
export const deleteCategory = (id) => request(`/categories/${id}`, { method: 'DELETE' })

// Settings
export const getSettings = () => request('/settings')
export const updateSettings = (body) => request('/settings', { method: 'PUT', body })

// Agent API: tokens and activity
export const getTokens = () => request('/tokens')
export const createApiToken = (name) => request('/tokens', { method: 'POST', body: { name } })
export const revokeApiToken = (id) => request(`/tokens/${id}`, { method: 'DELETE' })
export const getActivity = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString()
  return request(`/activity${qs ? `?${qs}` : ''}`)
}
export const revertActivity = (id) => request(`/activity/${id}/revert`, { method: 'POST' })

// yt-dlp cookies
export const getCookiesStatus = () => request('/cookies')
export const saveCookies = (content) => request('/cookies', { method: 'POST', body: { content } })
export const deleteCookies = () => request('/cookies', { method: 'DELETE' })

// Media URLs (used directly in <img> / <video> src)
export const thumbnailUrl = (file) => file.thumbnail_path ? `/thumbnails/${file.id}.jpg` : null
export const streamUrl = (id) => `/api/files/${id}/stream`
export const downloadUrl = (id) => `/api/files/${id}/download`
