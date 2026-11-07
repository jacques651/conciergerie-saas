// Hooks partagés : géolocalisation et livreurs en temps réel.
import { useEffect, useState } from 'react';
import { getSocket } from './socket';
import api from './api';

// Ouagadougou par défaut si la géolocalisation est refusée
export const DEFAULT_POS = { lat: 12.3714, lng: -1.5197 };

/** Position courante du navigateur (une fois) */
export function useGeolocation() {
  const [pos, setPos] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!navigator.geolocation) { setError('Géolocalisation non supportée'); setPos(DEFAULT_POS); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => { setError('Position refusée — position par défaut utilisée'); setPos(DEFAULT_POS); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);
  return { pos, error };
}

/**
 * Liste de livreurs chargée par `loader()` puis mise à jour en direct
 * via "livreur:position-update" / "livreur:offline" (sans rechargement).
 */
export function useLiveLivreurs(loader, deps = []) {
  const [livreurs, setLivreurs] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = () => loader().then((l) => alive && setLivreurs(l)).catch(() => {});
    load();
    const s = getSocket();
    const onUpdate = ({ livreurId, name, lat, lng, status }) =>
      setLivreurs((prev) => {
        // Le client ne voit que les livreurs "en_ligne" (disponibles)
        const keep = status === 'en_ligne' || status === 'en_livraison';
        const exists = prev.some((l) => l.id === livreurId);
        if (!keep) return prev.filter((l) => l.id !== livreurId);
        return exists
          ? prev.map((l) => (l.id === livreurId ? { ...l, lat, lng, status } : l))
          : [...prev, { id: livreurId, name, lat, lng, status }];
      });
    const onOffline = ({ livreurId }) => setLivreurs((prev) => prev.filter((l) => l.id !== livreurId));
    s?.on('livreur:position-update', onUpdate);
    s?.on('livreur:offline', onOffline);
    const t = setInterval(load, 30000); // resynchronisation de sécurité
    return () => { alive = false; clearInterval(t); s?.off('livreur:position-update', onUpdate); s?.off('livreur:offline', onOffline); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [livreurs, setLivreurs];
}

/**
 * Nombre de messages non lus, PERSISTANT (lu depuis le serveur).
 * - chargé au montage via GET /api/messages/unread-count
 * - +1 à chaque message reçu d'un autre utilisateur
 * - resynchronisé quand des messages sont marqués lus ("message:unread-count", émis par le serveur)
 * Le 2e paramètre est conservé pour compatibilité (resynchronise quand la messagerie s'ouvre/se ferme).
 */
export function useUnreadMessages(userId, open) {
  const [count, setCount] = useState(0);
  const refresh = () => api.get('/messages/unread-count').then(({ data }) => setCount(data.total)).catch(() => {});
  useEffect(() => { refresh(); }, [userId, open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onReceive = (m) => { if (m.from !== userId) setCount((c) => c + 1); };
    const onSync = ({ total }) => setCount(total);
    s.on('message:receive', onReceive);
    s.on('message:unread-count', onSync);
    s.on('connect', refresh); // reconnexion → resynchronisation
    return () => { s.off('message:receive', onReceive); s.off('message:unread-count', onSync); s.off('connect', refresh); };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  return count;
}
