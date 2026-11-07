// Notifications « toast » (en haut à droite) + écoute globale des événements temps réel.
// - <ToastProvider> : fournit toast({ title, body, type }) à toute l'application.
// - Événements écoutés : mission:new (avec son), message:receive, mission:status-update.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Bell, CheckCircle2, MessageCircle, PackagePlus, X, XCircle } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { getSocket } from '../socket';

const ToastCtx = createContext({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);

const ICON = { mission: PackagePlus, message: MessageCircle, success: CheckCircle2, danger: XCircle, info: Bell };
const DURATION = 6000;

// ---------- Son de notification (Web Audio API, aucun fichier externe) ----------
let audioCtx = null;
export function playNotificationSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    // Deux notes courtes (ding-dong) avec enveloppe douce
    [[880, 0], [1320, 0.16]].forEach(([freq, delay]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + delay);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + delay);
      osc.stop(t0 + delay + 0.4);
    });
  } catch { /* son bloqué par le navigateur (aucune interaction encore) : on ignore */ }
}

// Débloque l'audio au premier clic/touche (politique d'autoplay des navigateurs)
if (typeof window !== 'undefined') {
  const unlock = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) { audioCtx = audioCtx || new Ctx(); audioCtx.resume(); }
    } catch { /* ignoré */ }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function ToastItem({ t, onClose }) {
  const Icon = ICON[t.type] || Bell;
  useEffect(() => { const id = setTimeout(onClose, t.duration || DURATION); return () => clearTimeout(id); }, [t, onClose]);
  return (
    <div className={`tk-toast tk-toast-${t.type || 'info'}`} role="status" aria-live="polite">
      <span className="tk-toast-icon"><Icon size={18} /></span>
      <div className="min-w-0 flex-1">
        <p className="tk-toast-title">{t.title}</p>
        {t.body && <p className="tk-toast-body">{t.body}</p>}
      </div>
      <button className="tk-toast-close" onClick={onClose} aria-label="Fermer la notification"><X size={16} /></button>
    </div>
  );
}

const STATUS_TEXT = { accepted: 'acceptée', refused: 'refusée', en_cours: 'en cours de livraison', livree: 'livrée', annulee: 'annulée' };

export function ToastProvider({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  const [toasts, setToasts] = useState([]);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  const remove = useCallback((id) => setToasts((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback((t) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((l) => [...l.slice(-3), { id, ...t }]); // 4 notifications max à l'écran
    return id;
  }, []);

  // ---------- Événements socket globaux ----------
  useEffect(() => {
    if (!user) return;
    const s = getSocket();
    if (!s) return;

    const onMissionNew = ({ mission }) => {
      playNotificationSound();
      toast({
        type: 'mission', title: 'Nouvelle mission reçue !',
        body: `#${mission.id} · ${mission.client_name}${mission.delivery_price ? ` · ${Number(mission.delivery_price).toLocaleString('fr-FR')} FCFA` : ''}`
      });
    };
    const onMessage = (m) => {
      if (m.from === user.id) return;
      toast({ type: 'message', title: `Message reçu de ${m.fromName || 'un contact'}`, body: m.content.length > 80 ? `${m.content.slice(0, 80)}…` : m.content });
    };
    const onStatus = ({ missionId, status, livreurName }) => {
      // Commerçant : tous les statuts ; client : statuts intermédiaires (la livraison a sa propre notification)
      if (!STATUS_TEXT[status]) return;
      if (user.role === 'client' && status === 'livree') return;
      if (user.role !== 'commercant' && user.role !== 'client') return;
      toast({
        type: status === 'livree' || status === 'accepted' ? 'success' : status === 'refused' ? 'danger' : 'info',
        title: `Mission #${missionId} ${STATUS_TEXT[status]}`,
        body: livreurName ? `Livreur : ${livreurName}` : undefined
      });
    };

    // Client destinataire : commande assignée / livrée
    const onClientNew = ({ mission }) => {
      playNotificationSound();
      toast({ type: 'mission', title: 'Nouvelle commande en route !', body: `#${mission.id} · ${mission.commercant_name || 'Commerçant'}${mission.livreur_name ? ` · ${mission.livreur_name}` : ''}` });
    };
    const onClientDone = ({ mission }) => {
      playNotificationSound();
      toast({ type: 'success', title: `Commande #${mission.id} livrée`, body: 'Vous pouvez noter le livreur dans « Mes commandes ».' });
    };

    s.on('mission:new', onMissionNew);
    s.on('mission:new-client', onClientNew);
    s.on('mission:completed-client', onClientDone);
    s.on('message:receive', onMessage);
    s.on('mission:status-update', onStatus);
    return () => { s.off('mission:new-client', onClientNew); s.off('mission:completed-client', onClientDone); s.off('mission:new', onMissionNew); s.off('message:receive', onMessage); s.off('mission:status-update', onStatus); };
  }, [user?.id, user?.role, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div className="tk-portal tk-toasts">
          {toasts.map((t) => <ToastItem key={t.id} t={t} onClose={() => remove(t.id)} />)}
        </div>,
        document.body
      )}
    </ToastCtx.Provider>
  );
}
