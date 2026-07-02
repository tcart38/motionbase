import 'dotenv/config'
import path from 'path'

const dataDir = process.env.DATA_DIR || '/data'

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  mediaDir: process.env.MEDIA_DIR || '/media',
  dataDir,
  dbPath: path.join(dataDir, 'motionbase.db'),
  thumbnailsDir: path.join(dataDir, 'thumbnails'),
  scanInterval: parseInt(process.env.SCAN_INTERVAL || '30', 10),
  isProd: process.env.NODE_ENV === 'production',
}
