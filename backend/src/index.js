import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'
import { initDb } from './db/index.js'
import { initScheduler } from './services/scheduler.js'
import filesRouter from './routes/files.js'
import scanRouter from './routes/scan.js'
import tagsRouter from './routes/tags.js'
import categoriesRouter from './routes/categories.js'
import settingsRouter from './routes/settings.js'
import importRouter from './routes/import.js'
import uploadRouter from './routes/upload.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

initDb()
initScheduler()

const app = express()
app.use(cors())
app.use(express.json())

// Serve generated thumbnails
app.use('/thumbnails', express.static(config.thumbnailsDir))

app.use('/api/files', filesRouter)
app.use('/api/scan', scanRouter)
app.use('/api/tags', tagsRouter)
app.use('/api/categories', categoriesRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/import', importRouter)
app.use('/api/upload', uploadRouter)

// Serve built frontend in production (Docker)
if (config.isProd) {
  const publicDir = path.join(__dirname, '../public')
  app.use(express.static(publicDir))
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'))
  })
}

app.listen(config.port, () => {
  console.log(`MotionBase running on http://localhost:${config.port}`)
  console.log(`  Media dir : ${config.mediaDir}`)
  console.log(`  Data dir  : ${config.dataDir}`)
})
