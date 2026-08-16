import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { tokenStore } from '../api/client.js';
import { can as canDo } from './permissions.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [authConfig, setAuthConfig] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous

  /** How sign-in behaves comes from the server, never from the bundle. */
  useEffect(() => {
    api
      .get('/auth/config')
      .then(setAuthConfig)
      .catch(() => setAuthConfig({ registrationOpen: false, minPasswordLength: 12 }));
  }, []);

  const loadSession = useCallback(async () => {
    if (!tokenStore.access) {
      setStatus('anonymous');
      return null;
    }
    try {
      const session = await api.get('/auth/me');
      setUser(session.user);
      setCapabilities(session.capabilities);
      setStatus('authenticated');
      return session;
    } catch {
      tokenStore.clear();
      setUser(null);
      setCapabilities(null);
      setStatus('anonymous');
      return null;
    }
  }, []);

  // Permissions are re-fetched from the server on every load, so a role change
  // takes effect the next time the page opens rather than at token expiry.
  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const login = useCallback(async (email, password) => {
    const session = await api.post('/auth/login', { email, password });
    tokenStore.set(session);
    setUser(session.user);
    setCapabilities(session.capabilities);
    setStatus('authenticated');
    return session;
  }, []);

  /** Creating an account signs you in straight away — the server returns a session. */
  const register = useCallback(async (details) => {
    const session = await api.post('/auth/register', details);
    tokenStore.set(session);
    setUser(session.user);
    setCapabilities(session.capabilities);
    setStatus('authenticated');
    return session;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Signing out locally matters more than the server acknowledging it.
    }
    tokenStore.clear();
    setUser(null);
    setCapabilities(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo(
    () => ({
      user,
      capabilities,
      authConfig,
      status,
      isAuthenticated: status === 'authenticated',
      login,
      register,
      logout,
      reload: loadSession,
      can: (action, module) => canDo(capabilities, action, module),
    }),
    [user, capabilities, authConfig, status, login, register, logout, loadSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an <AuthProvider>.');
  return context;
}
