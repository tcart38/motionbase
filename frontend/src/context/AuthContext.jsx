import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LOGIN_REQUIRED_EVENT, authLogout, getAuthStatus } from '@/api/client.js'

const AuthContext = createContext(null)

/**
 * Login is optional. `enabled` false means the app behaves as before: everyone is effectively an admin.
 * `ready` is false until /api/auth/status has answered, so nothing flashes before we know.
 */
export function AuthProvider({ children }) {
  const qc = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: getAuthStatus,
    staleTime: 60_000,
    retry: 2,
  })

  // Any API call that comes back 401 login_required sends us to the login page.
  useEffect(() => {
    const onRequired = () => qc.setQueryData(['auth', 'status'], (prev) => ({ ...(prev ?? {}), enabled: true, user: null }))
    window.addEventListener(LOGIN_REQUIRED_EVENT, onRequired)
    return () => window.removeEventListener(LOGIN_REQUIRED_EVENT, onRequired)
  }, [qc])

  // Drops everything cached for the previous session, then reloads who we are.
  const reset = useCallback(async (status) => {
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' })
    if (status) qc.setQueryData(['auth', 'status'], status)
    else await qc.invalidateQueries({ queryKey: ['auth', 'status'] })
  }, [qc])

  const signOut = useCallback(async () => {
    try { await authLogout() } catch { /* the cookie is cleared server side either way */ }
    await reset()
  }, [reset])

  const value = useMemo(() => {
    const enabled = !!data?.enabled
    const user = data?.user ?? null
    return {
      ready: !isLoading && !isError,
      failed: isError,
      retry: refetch,
      enabled,
      user,
      signupsEnabled: enabled && !!data?.signups_enabled,
      signupsRequireApproval: data?.signups_require_approval !== false,
      setupRequired: !!data?.setup_required,
      version: data?.version,
      // With login off everyone has full access, as before accounts existed.
      isAdmin: !enabled || user?.role === 'admin',
      loggedOut: enabled && !user,
      reset,
      signOut,
    }
  }, [data, isLoading, isError, refetch, reset, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
