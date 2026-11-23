// SQLite datetime('now') values are UTC without a zone marker.
export const parseUtc = (s) => (s ? new Date(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')) : null)

export function absoluteTime(s) {
  const d = parseUtc(s)
  return d ? d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never'
}

export function relativeTime(s, now = Date.now()) {
  const d = parseUtc(s)
  if (!d) return 'never'
  const secs = Math.round((now - d.getTime()) / 1000)
  if (secs < 45) return 'just now'
  const units = [['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800], ['month', 2592000], ['year', 31536000]]
  let best = ['minute', 60]
  for (const u of units) if (secs >= u[1]) best = u
  const n = Math.floor(secs / best[1])
  return `${n} ${best[0]}${n === 1 ? '' : 's'} ago`
}

export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Where a file came from, for people who have no account behind it.
export function sourceLabel(source) {
  switch (source) {
    case 'scan': return 'Library scan'
    case 'import': return 'Imported'
    case 'user': return 'Uploaded'
    default: return 'Unknown (before accounts)'
  }
}

// Short "who added this" label for a file, or null when there is nothing worth showing.
export function uploaderLabel(file) {
  if (file.uploader) return file.uploader.display_name || file.uploader.username
  if (file.upload_source === 'scan') return 'Library scan'
  if (file.upload_source === 'import') return 'Imported'
  return null
}
