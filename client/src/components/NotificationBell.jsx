// Cloche de notifications (tous les rôles) : badge des non-lues, panneau déroulant, temps réel.
// GET /api/notifications · POST /api/notifications/:id/read · POST /api/notifications/read-all
// Socket : "notification:new" (personnelle) et "notification:admin" (admins).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, UserPlus, Package, CheckCircle2, CheckCheck } from 'lucide-react';
import api from '../api';
import { getSocket } from '../socket';

const ICON = { account_request: UserPlus, mission_created: Package, mission_completed: CheckCircle2 };
const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
};

export default function NotificationBell() {
  const nav = useNavigate();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(() => api.get('/notifications')
    .then(({ data }) => { setItems(data.notifications); setUnread(data.unread); }).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  // Temps réel
  useEffect(() => {
    const s = getSocket();
    const onNew = (n) => { setItems((p) => [n, ...p.filter((x) => x.id !== n.id)].slice(0, 50)); setUnread((u) => u + 1); };
    s?.on('notification:new', onNew);
    s?.on('notification:admin', onNew);
    return () => { s?.off('notification:new', onNew); s?.off('notification:admin', onNew); };
  }, []);

  // Fermeture au clic extérieur / Échap
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const openItem = (n) => {
    if (!n.is_read) {
      api.post(`/notifications/${n.id}/read`).catch(() => {});
      setItems((p) => p.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
      setUnread((u) => Math.max(0, u - 1));
    }
    setOpen(false);
    if (n.link) nav(n.link);
  };
  const readAll = () => {
    api.post('/notifications/read-all').catch(() => {});
    setItems((p) => p.map((x) => ({ ...x, is_read: 1 })));
    setUnread(0);
  };

  return (
    <div className="tk-user" ref={ref}>
      <button className="tk-round-btn relative" onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? ` (${unread} non lues)` : ''}`} aria-haspopup="menu" aria-expanded={open}>
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-[18px] text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="tk-user-menu tk-notif-panel" role="menu">
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--tk-border)' }}>
            <span className="font-semibold">Notifications</span>
            {unread > 0 && (
              <button className="!w-auto !px-2 !py-1 text-xs" onClick={readAll}><CheckCheck size={14} /> Tout marquer comme lu</button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-gray-500">Aucune notification.</p>}
            {items.map((n) => {
              const Icon = ICON[n.type] || Bell;
              return (
                <button key={n.id} role="menuitem" onClick={() => openItem(n)} className="!items-start"
                  style={n.is_read ? { opacity: 0.65 } : { background: 'var(--tk-accent-50)' }}>
                  <Icon size={16} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1 text-left">
                    <span className={`block whitespace-normal text-sm ${n.is_read ? '' : 'font-semibold'}`}>{n.message}</span>
                    <span className="block text-xs text-gray-500">{ago(n.created_at)}</span>
                  </span>
                  {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-600" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
