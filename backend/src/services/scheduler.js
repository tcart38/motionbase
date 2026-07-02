import { getDb } from '../db/index.js'
import { runScan } from './scanner.js'

let timer = null

export function initScheduler() {
  reschedule()
}

export function reschedule() {
  if (timer) clearInterval(timer)

  const db = getDb()
  const row = db.prepare("SELECT value FROM settings WHERE key = 'scan_interval'").get()
  const minutes = parseInt(row?.value || '30', 10)

  if (minutes <= 0) return // 0 = disabled

  timer = setInterval(() => {
    runScan().catch(console.error)
  }, minutes * 60 * 1000)

  console.log(`Scheduler: will auto-scan every ${minutes} minutes`)
}
