/** Turn the flat /api/folders list into a nested tree (children sorted as the server sent them). */
export function buildTree(folders) {
  const byId = new Map(folders.map((f) => [f.id, { ...f, children: [] }]))
  const roots = []
  for (const f of byId.values()) {
    const parent = f.parent_id != null ? byId.get(f.parent_id) : null
    ;(parent ? parent.children : roots).push(f)
  }
  return roots
}

/** Depth-first flat list with a depth field, for pickers. */
export function flattenTree(nodes, depth = 0, out = []) {
  for (const n of nodes) {
    out.push({ ...n, depth })
    flattenTree(n.children, depth + 1, out)
  }
  return out
}

export function folderPath(folders, id) {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const parts = []
  const seen = new Set()
  for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = byId.get(cur.parent_id)) {
    seen.add(cur.id)
    parts.unshift(cur.name)
  }
  return parts
}

/** The folder and everything below it. */
export function descendantIds(folders, id) {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of folders) {
      if (f.parent_id != null && out.has(f.parent_id) && !out.has(f.id)) { out.add(f.id); grew = true }
    }
  }
  return out
}
