import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'
import filesRouter from './routes/files.js'
import scanRouter from './routes/scan.js'
import tagsRouter from './routes/tags.js'
import categoriesRouter from './routes/categories.js'
import settingsRouter from './routes/settings.js'
import importRouter from './routes/import.js'
import uploadRouter from './routes/upload.js'
import foldersRouter from './routes/folders.js'
import tokensRouter from './routes/tokens.js'
import activityRouter from './routes/activity.js'
import cookiesRouter from './routes/cookies.js'
import agentRouter from './routes/agent.js'
import mcpRouter from './routes/mcp.js'
import authRouter from './routes/auth.js'
import usersRouter from './routes/users.js'
import adminRouter from './routes/admin.js'
import exportRouter, { metadataImportRouter } from './routes/export.js'
import { sessionMiddleware } from './middleware/session.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Builds the Express app. The database must already be initialised (initDb()).
export function createApp({ serveFrontend = config.isProd } = {}) {
  const app = express()
  if (config.trustProxy) app.set('trust proxy', true)
  app.use(cors())
  // The metadata restore route takes a much larger JSON body; it parses its own (after the admin check).
  const smallJson = express.json({ limit: '2mb' })
  app.use((req, res, next) => (req.path === '/api/import/metadata' ? next() : smallJson(req, res, next)))

  // Optional login: sets req.user / req.authEnabled and enforces sessions when login is on.
  app.use(sessionMiddleware)
  app.get('/api/health', (req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRouter)
  app.use('/api/users', usersRouter)
  app.use('/api/admin', adminRouter)

  // Serve generated thumbnails
  app.use('/thumbnails', express.static(config.thumbnailsDir))

  app.use('/api/files', filesRouter)
  app.use('/api/scan', scanRouter)
  app.use('/api/tags', tagsRouter)
  app.use('/api/categories', categoriesRouter)
  app.use('/api/settings', settingsRouter)
  app.use('/api/import/metadata', metadataImportRouter)
  app.use('/api/import', importRouter)
  app.use('/api/export', exportRouter)
  app.use('/api/cookies', cookiesRouter)
  app.use('/api/upload', uploadRouter)
  app.use('/api/folders', foldersRouter)
  app.use('/api/tokens', tokensRouter)
  app.use('/api/activity', activityRouter)
  app.use('/api/agent/v1', agentRouter)
  app.use('/mcp', mcpRouter)

  // Serve built frontend in production (Docker)
  if (serveFrontend) {
    const publicDir = path.join(__dirname, '../public')
    app.use(express.static(publicDir))
    app.get('*', (req, res) => {
      res.sendFile(path.join(publicDir, 'index.html'))
    })
  }

  // JSON error responses (bad JSON bodies, unexpected throws)
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err)
    const status = err.status || err.statusCode || 500
    if (status === 500) console.error(err)
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message })
  })

  return app
}
