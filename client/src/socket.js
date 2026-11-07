// Singleton Socket.io authentifié par JWT.
import { io } from 'socket.io-client';
import { API_URL, getToken } from './api';

let socket = null;

export function getSocket() {
  const token = getToken();
  if (!token) return null;
  if (socket && socket.auth?.token === token) return socket;
  socket?.disconnect();
  socket = io(API_URL || undefined, { auth: { token }, transports: ['websocket', 'polling'] });

  // Abonnement expiré côté serveur (cron) → redirection
  socket.on('subscription:expired', () => {
    if (window.location.pathname !== '/abonnement') window.location.assign('/abonnement?expired=1');
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
