import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { triggerScan, getScanStatus } from '@/api/client.js'

/** Starts a library scan, polls until it finishes, reports through toasts. */
export function useScan() {
  const [scanning, setScanning] = useState(false)
  const timer = useRef(null)
  const qc = useQueryClient()

  useEffect(() => () => clearInterval(timer.current), [])

  const scan = useCallback(async () => {
    try {
      setScanning(true)
      await triggerScan()
      toast.info('Scanning library…')
      timer.current = setInterval(async () => {
        const status = await getScanStatus().catch(() => null)
        if (status && !status.isScanning) {
          clearInterval(timer.current)
          setScanning(false)
          const r = status.lastScanResult
          toast.success(r ? `Scan done: ${r.added} added, ${r.missing} missing` : 'Scan done')
          qc.invalidateQueries()
        }
      }, 1000)
    } catch (err) {
      setScanning(false)
      toast.error(err.message)
    }
  }, [qc])

  return { scanning, scan }
}
