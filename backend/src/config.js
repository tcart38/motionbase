import 'dotenv/config'
import path from 'path'

// Values are read lazily (on every access) so tests and embedders can change
// process.env before calling initDb()/createApp().
const str = (key, def) => process.env[key] || def
const int = (key, def) => parseInt(process.env[key] || String(def), 10)

export const config = {
  get port() { return int('PORT', 3001) },
  get mediaDir() { return str('MEDIA_DIR', '/media') },
  get dataDir() { return str('DATA_DIR', '/data') },
  get dbPath() { return path.join(this.dataDir, 'motionbase.db') },
  get thumbnailsDir() { return path.join(this.dataDir, 'thumbnails') },
  get framesDir() { return path.join(this.dataDir, 'frames') },
  get scanInterval() { return int('SCAN_INTERVAL', 30) },
  get isProd() { return process.env.NODE_ENV === 'production' },
  get frameConcurrency() { return Math.max(1, int('FRAME_CONCURRENCY', 2)) },
  get agentApiToken() { return process.env.AGENT_API_TOKEN || '' },
}
