import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Library from './pages/Library.jsx'
import Inbox from './pages/Inbox.jsx'
import AddMedia from './pages/AddMedia.jsx'
import Player from './pages/Player.jsx'
import Trash from './pages/Trash.jsx'
import Settings from './pages/Settings.jsx'
import Login from './pages/Login.jsx'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { Button } from './components/ui/button.jsx'
import { Spinner } from './components/ui/spinner.jsx'

// Nothing of the app renders until we know whether login is on and who is signed in.
function Gate({ children }) {
  const { ready, failed, retry, loggedOut } = useAuth()
  if (failed) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-sm font-medium">Could not reach MotionBase</p>
        <p className="text-xs text-muted-foreground">Check that the server is running, then try again.</p>
        <Button variant="outline" onClick={() => retry()}>Try again</Button>
      </main>
    )
  }
  if (!ready) {
    return <main className="flex min-h-svh items-center justify-center" aria-busy="true" aria-label="Loading"><Spinner /></main>
  }
  if (loggedOut) return <Login />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <Gate>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/library" replace />} />
              <Route path="library" element={<Library />} />
              <Route path="inbox" element={<Inbox />} />
              <Route path="add-media" element={<AddMedia />} />
              <Route path="player/:id" element={<Player />} />
              <Route path="trash" element={<Trash />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </Gate>
    </AuthProvider>
  )
}
