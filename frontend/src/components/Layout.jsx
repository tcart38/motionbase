import React, { useState, useCallback } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Film, PlusCircle, Settings, RefreshCw } from 'lucide-react'
import { triggerScan, getScanStatus } from '../api/client.js'

const navItems = [
  { to: '/library', icon: Film, label: 'Library' },
  { to: '/add-media', icon: PlusCircle, label: 'Add Media' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function Layout() {
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState(null)

  const handleScan = useCallback(async () => {
    try {
      setScanning(true)
      setScanMsg(null)
      await triggerScan()
      setScanMsg('Scanning…')
      // Poll until done
      const poll = setInterval(async () => {
        const status = await getScanStatus().catch(() => null)
        if (status && !status.isScanning) {
          clearInterval(poll)
          setScanning(false)
          const r = status.lastScanResult
          setScanMsg(r ? `+${r.added} added, ${r.missing} missing` : 'Done')
          setTimeout(() => setScanMsg(null), 4000)
        }
      }, 1000)
    } catch (err) {
      setScanning(false)
      setScanMsg(err.message)
      setTimeout(() => setScanMsg(null), 4000)
    }
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <nav className="w-52 flex-shrink-0 flex flex-col bg-white border-r border-slate-200
                      dark:bg-slate-900 dark:border-white/[0.06]">
        <div className="px-4 py-5">
          <span className="text-base font-semibold text-slate-900 dark:text-slate-100 tracking-tight">MotionBase</span>
        </div>

        <div className="flex-1 px-2 space-y-0.5">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-150 ${
                  isActive
                    ? 'bg-brand/10 text-brand font-medium'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </div>

        <div className="p-3 border-t border-slate-200 dark:border-white/[0.06]">
          <button
            onClick={handleScan}
            disabled={scanning}
            className="btn-ghost w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning…' : 'Scan Now'}
          </button>
          {scanMsg && (
            <p className="mt-1.5 text-center text-xs text-slate-500 dark:text-slate-400">{scanMsg}</p>
          )}
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
