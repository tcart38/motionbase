import { existsSync } from 'fs'
import { applyBaseSchema, seed } from './schema.js'

// Ordered, additive-only migrations. Each runs in its own transaction and bumps
// PRAGMA user_version. Never edit a released migration; append a new one.
export const migrations = []

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
