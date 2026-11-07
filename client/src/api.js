// Client HTTP Axios + intercepteurs (JWT, 401 → /login, 402 → /abonnement).
import axios from 'axios';

// URL de l'API :
//  - production (Vercel) : VITE_API_URL = https://votre-backend.onrender.com (client/.env.production ou variables Vercel)
//  - développement : vide → appels relatifs /api via le proxy Vite (fonctionne aussi depuis le réseau local)
export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

const api = axios.create({ baseURL: `${API_URL}/api` });

export const getToken = () => localStorage.getItem('token');

api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err.response?.status;
    const path = window.location.pathname;
    // Abonnement expiré → page de paiement
    if (status === 402 && path !== '/abonnement') window.location.assign('/abonnement');
    // Jeton invalide → reconnexion
    if (status === 401 && !['/login', '/register'].includes(path)) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.assign('/login');
    }
    return Promise.reject(err);
  }
);

/** Message d'erreur lisible */
export const errMsg = (e) => e?.response?.data?.error || e?.message || 'Erreur inattendue';

export default api;
