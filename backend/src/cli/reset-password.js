// Account recovery for a locked-out install (run against the same DATA_DIR as the server):
//   node src/cli/reset-password.js <username> <new-password>   set a new password (also re-enables the account)
//   node src/cli/reset-password.js --disable-login             turn login off again
//   both can be combined: node src/cli/reset-password.js <username> <new-password> --disable-login
// In Docker: docker exec -it motionbase node src/cli/reset-password.js alice 'a-new-long-password'
import { pathToFileURL } from 'url'
import { initDb, closeDb } from '../db/index.js'
import { audit, deleteUserSessions, getUserByName, setAuthEnabled, setPassword } from '../services/auth.js'

export async function run(argv) {
  const flags = argv.filter((a) => a.startsWith('--'))
  const args = argv.filter((a) => !a.startsWith('--'))
  const disableLogin = flags.includes('--disable-login')
  const unknown = flags.filter((f) => f !== '--disable-login')
  if (unknown.length || args.length === 1 || args.length > 2 || (!args.length && !disableLogin)) {
    throw new Error('Usage: reset-password.js <username> <new-password> [--disable-login]\n       reset-password.js --disable-login')
  }
  const db = initDb()
  try {
    if (args.length === 2) {
      const [username, password] = args
      const user = getUserByName(db, username)
      if (!user) throw new Error(`No user named "${username}"`)
      await setPassword(db, user.id, password)
      db.prepare('UPDATE users SET disabled_at = NULL, pending = 0 WHERE id = ?').run(user.id)
      deleteUserSessions(db, user.id)
      audit(db, { user_id: null, label: 'CLI' }, 'user_password_reset', { id: user.id, username: user.username, via: 'cli' })
      console.log(`Password reset for ${user.username}. All their sessions were signed out.`)
    }
    if (disableLogin) {
      setAuthEnabled(db, false)
      audit(db, { user_id: null, label: 'CLI' }, 'login_disabled', { via: 'cli' })
      console.log('Login is now off. Sign in as an admin and turn it back on from Settings (or POST /api/auth/enable).')
    }
  } finally {
    closeDb()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
