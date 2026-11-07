// Contexte d'authentification (utilisateur + statut d'abonnement).
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from './api';
import { disconnectSocket } from './socket';

const AuthCtx = createContext(null);

const read = () => { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(read);
  const [subscription, setSubscription] = useState(null);

  const refreshSubscription = useCallback(async () => {
    if (!localStorage.getItem('token')) return null;
    try {
      const { data } = await api.get('/subscription/status');
      setSubscription(data);
      return data;
    } catch { return null; }
  }, []);

  useEffect(() => { if (user) refreshSubscription(); }, [user, refreshSubscription]);

  const saveSession = (data) => {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify({ ...data.user, livreurStatus: data.livreurStatus }));
    setUser({ ...data.user, livreurStatus: data.livreurStatus });
    setSubscription(data.subscription);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    disconnectSocket();
    setUser(null);
    setSubscription(null);
  };

  return (
    <AuthCtx.Provider value={{ user, subscription, saveSession, logout, refreshSubscription }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);

/** Page d'accueil selon le rôle */
export const homeFor = (role) =>
  ({ admin: '/admin', livreur: '/livreur', commercant: '/commercant', client: '/carte' }[role] || '/login');
