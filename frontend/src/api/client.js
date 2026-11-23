const BASE = '/api'

export class ApiError extends Error {
  constructor(message, { status, retryAfter, loginRequired } = {}) {
    super(message)
    this.status = status
    this.retryAfter = retryAfter ?? null
    this.loginRequired = !!loginRequired
  }
}

// Fired when the server says a session is needed (login was turned on, or the session expired).
export const LOGIN_REQUIRED_EVENT = 'mb:login-required'

export async function parseError(res) {
  const body = await res.json().catch(() => ({ error: res.statusText }))
  const retryAfter = body.retry_after ?? (Number(res.headers.get('Retry-After')) || null)
  if (res.status === 401 && body.login_required) window.dispatchEvent(new Event(LOGIN_REQUIRED_EVENT))
  const err = new ApiError(body.error || `HTTP ${res.status}`, { status: res.status, retryAfter, loginRequired: !!body.login_required })
  err.body = body
  return err
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) throw await parseError(res)
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
export const getFileHistory = (id) => request(`/files/${id}/history`)
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

// Accounts
export const getAuthStatus = () => request('/auth/status')
export const authSetup = (body) => request('/auth/setup', { method: 'POST', body })
export const authEnable = (body) => request('/auth/enable', { method: 'POST', body })
export const authLogin = (body) => request('/auth/login', { method: 'POST', body })
export const authLogout = () => request('/auth/logout', { method: 'POST' })
export const authDisable = (password) => request('/auth/disable', { method: 'POST', body: { password } })
export const changeOwnPassword = (current, next) => request('/auth/password', { method: 'POST', body: { current, new: next } })
export const updateMe = (display_name) => request('/auth/me', { method: 'PATCH', body: { display_name } })
export const authSignup = (body) => request('/auth/signup', { method: 'POST', body })
export const approveUser = (id) => request(`/users/${id}/approve`, { method: 'POST' })
export const rejectUser = (id) => request(`/users/${id}/reject`, { method: 'POST' })
export const getUsers = () => request('/users')
export const getUserDirectory = () => request('/auth/directory')
export const createUser = (body) => request('/users', { method: 'POST', body })
export const updateUser = (id, body) => request(`/users/${id}`, { method: 'PATCH', body })
export const resetUserPassword = (id, password) => request(`/users/${id}/password`, { method: 'POST', body: { password } })
export const getAudit = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString()
  return request(`/admin/audit${qs ? `?${qs}` : ''}`)
}

// Media URLs (used directly in <img> / <video> src)
export const thumbnailUrl = (file) => file.thumbnail_path ? `/thumbnails/${file.id}.jpg` : null
export const streamUrl = (id) => `/api/files/${id}/stream`
export const downloadUrl = (id) => `/api/files/${id}/download`

// Export / restore
export const getExportEstimate = (include_trash) => request(`/export/estimate?include_trash=${include_trash ? 1 : 0}`)
export const getExportJobs = () => request('/export/jobs')
export const getExportJob = (id) => request(`/export/jobs/${id}`)
export const createExportJob = (body) => request('/export/jobs', { method: 'POST', body })
export const cancelExportJob = (id) => request(`/export/jobs/${id}/cancel`, { method: 'POST', body: {} })
export const deleteExportJob = (id) => request(`/export/jobs/${id}`, { method: 'DELETE' })
// Restore takes the raw metadata.json text (can be large), so it bypasses the JSON helper.
export async function importMetadata(text, { dryRun, overwriteNotes }) {
  const qs = new URLSearchParams({ dry_run: dryRun ? '1' : '0', overwrite_notes: overwriteNotes ? '1' : '0' })
  const res = await fetch(`${BASE}/import/metadata?${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text })
  if (!res.ok) throw await parseError(res)
  return res.json()
}
