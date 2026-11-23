import { config } from './config.js'
import { initDb } from './db/index.js'
import { initScheduler } from './services/scheduler.js'
import { createApp } from './app.js'

initDb()
initScheduler()

const app = createApp()

app.listen(config.port, () => {
  console.log(`MotionBase running on http://localhost:${config.port}`)
  console.log(`  Media dir : ${config.mediaDir}`)
  console.log(`  Data dir  : ${config.dataDir}`)
})
