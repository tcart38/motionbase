import { existsSync } from 'fs'
import { applyBaseSchema, seed } from './schema.js'
import * as m001 from './migrations/001-folders-review-source.js'
import * as m002 from './migrations/002-agent-api.js'
import * as m003 from './migrations/003-trash.js'
import * as m004 from './migrations/004-accounts.js'
import * as m005 from './migrations/005-signups.js'
import * as m006 from './migrations/006-media-groups.js'

// Ordered, additive-only migrations. Each runs in its own transaction and bumps
// PRAGMA user_version. Never edit a released migration; append a new one.
export const migrations = [m001, m002, m003, m004, m005, m006]

export function runMigrations(db, { dbPath, backup = true } = {}) {
  const hadSchema = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='files'").get()

  applyBaseSchema(db)

  const current = db.pragma('user_version', { simple: true })
  const pending = migrations.filter((m) => m.version > current)

  if (pending.length > 0 && backup && hadSchema && dbPath && dbPath !== ':memory:' && existsSync(dbPath)) {
    const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)
    const target = `${dbPath}.pre-v${pending[0].version}-${stamp}.bak`
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  }

  for (const m of pending) {
    db.transaction(() => {
      m.up(db)
      db.pragma(`user_version = ${m.version}`)
    })()
  }

  seed(db)
}
