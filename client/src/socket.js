// Singleton Socket.io authentifié par JWT.
// Production (Vercel) : se connecte à VITE_API_URL (backend Render), jamais au domaine Vercel.
import { io } from 'socket.io-client';
import { API_URL, getToken } from './api';

let socket = null;
// Écouteurs « durables » : rattachés automatiquement à chaque nouvelle instance du socket
// (changement de jeton, reconnexion après login) → aucun écouteur perdu sur une ancienne instance.
const durable = new Map(); // event → Set<fn>

/** subscribe('notification:nouvelle', fn) → fonction de désinscription */
export function subscribe(event, fn) {
  if (!durable.has(event)) durable.set(event, new Set());
  durable.get(event).add(fn);
  getSocket()?.on(event, fn);
  return () => { durable.get(event)?.delete(fn); socket?.off(event, fn); };
}

if (import.meta.env.PROD && !API_URL) {
  console.error('❌ VITE_API_URL absente au build : le socket va viser le domaine du frontend au lieu de Render. Définissez-la dans Vercel puis Redeploy.');
}

export function getSocket() {
  const token = getToken();
  if (!token) return null;
  if (socket && socket.auth?.token === token) return socket;
  if (socket) console.warn('♻️ SOCKET recréé (nouveau jeton) : une seule instance active');
  socket?.disconnect();
  socket?.removeAllListeners();
  socket = io(API_URL || undefined, {
    auth: { token },
    transports: ['websocket', 'polling'], // repli en long-polling si le WebSocket est bloqué
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 20000 // Render peut mettre du temps à sortir de veille
  });

  // Diagnostic de connexion (console du navigateur)
  console.log('🔗 SOCKET URL:', API_URL || `${window.location.origin} (relative : VITE_API_URL absente !)`);
  socket.on('connect', () => console.log('✅ SOCKET CONNECTÉ, ID:', socket.id, '· transport:', socket.io.engine.transport.name));
  socket.on('connect_error', (err) => console.error('❌ SOCKET ERREUR:', err.message, '→', API_URL || window.location.origin));
  socket.on('disconnect', (reason) => console.warn('🔌 SOCKET DÉCONNECTÉ:', reason));
  socket.on('notification:nouvelle', (n) => console.log('🔔 NOTIFICATION REÇUE:', n.type, n.message));
  socket.on('error:message', (e) => console.log('❌ Refus serveur :', e?.error));

  // Abonnement expiré côté serveur (cron ou action refusée) → redirection
  socket.on('subscription:expired', () => {
    console.log('⚠️ Socket : abonnement inactif, action temps réel refusée');
    if (window.location.pathname !== '/abonnement') window.location.assign('/abonnement?expired=1');
  });
  // Rattache les écouteurs durables à cette instance
  durable.forEach((fns, event) => fns.forEach((fn) => socket.on(event, fn)));
  if (typeof window !== 'undefined') window.__socket = socket; // test console : __socket.id
  return socket;
}

/** Infos de diagnostic : id local + nombre de connexions vues par le serveur dans la room de l'utilisateur */
export async function socketDiagnostic(api) {
  const s = getSocket();
  const local = { connecte: !!s?.connected, id: s?.id || null, transport: s?.io?.engine?.transport?.name || null, url: API_URL || window.location.origin };
  try { const { data } = await api.get('/notifications/socket-status'); return { ...local, serveur: data }; }
  catch (e) { return { ...local, serveur: `erreur ${e.response?.status || e.message}` }; }
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
