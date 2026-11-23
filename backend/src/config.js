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
  // Server-side export jobs write here (never inside MEDIA_DIR). Override with EXPORT_DIR.
  get exportDir() { return process.env.EXPORT_DIR || path.join(this.dataDir, 'exports') },
  get thumbnailsDir() { return path.join(this.dataDir, 'thumbnails') },
  get framesDir() { return path.join(this.dataDir, 'frames') },
  get scanInterval() { return int('SCAN_INTERVAL', 30) },
  get isProd() { return process.env.NODE_ENV === 'production' },
  get frameConcurrency() { return Math.max(1, int('FRAME_CONCURRENCY', 2)) },
  // Set TRUST_PROXY=1 behind a reverse proxy so client IPs (login rate limit) come from X-Forwarded-For.
  get trustProxy() { return ['1', 'true'].includes(String(process.env.TRUST_PROXY || '').toLowerCase()) },
  get agentApiToken() { return process.env.AGENT_API_TOKEN || '' },
}
