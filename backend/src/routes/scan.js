import { Router } from 'express'
import { runScan, getScanState } from '../services/scanner.js'

const router = Router()

router.post('/', async (req, res) => {
  const { isScanning } = getScanState()
  if (isScanning) return res.status(409).json({ error: 'Scan already in progress' })

  runScan()
    .then((result) => console.log('Scan complete:', result))
    .catch(console.error)

  res.json({ message: 'Scan started' })
})

router.get('/status', (req, res) => {
  res.json(getScanState())
})

export default router
