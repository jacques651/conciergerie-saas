// Espace client : carte des livreurs disponibles + partage de position + messagerie.
import { useMemo, useState } from 'react';
import { haversine, formatDistance } from '../geo';
import api from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../auth.jsx';
import AppLayout from '../components/AppLayout.jsx';
import Modal from '../components/Modal.jsx';
import { MessageCircle, ShoppingBag, Bike } from 'lucide-react';
import LivreurList from '../components/LivreurList.jsx';
import MesCommandes, { useMesCommandes } from '../components/MesCommandes.jsx';
import MapView from '../components/MapView.jsx';
import Messagerie from '../components/Messagerie.jsx';
import { useGeolocation, useLiveLivreurs, useUnreadMessages } from '../hooks';

export default function CarteClient() {
  const { user } = useAuth();
  const { pos, error } = useGeolocation();
  const [rawLivreurs] = useLiveLivreurs(() => api.get('/client/livreurs').then((r) => r.data));
  // Distance en temps réel (Haversine) entre le client et chaque livreur
  const livreurs = useMemo(() => rawLivreurs.map((l) => {
    const d = haversine(pos, l);
    return { ...l, distance_km: d == null ? null : Math.round(d * 100) / 100 };
  }), [rawLivreurs, pos]);
  const available = livreurs.filter((l) => l.status === 'en_ligne');
  const delivering = livreurs.filter((l) => l.status === 'en_livraison').sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9));
  const [selectedId, setSelectedId] = useState(null);
  const [msgOpen, setMsgOpen] = useState(false);
  const [contact, setContact] = useState(null); // conversation à ouvrir dans la messagerie
  const [toast, setToast] = useState('');
  const unread = useUnreadMessages(user.id, msgOpen);

  const showToast = (t) => { setToast(t); setTimeout(() => setToast(''), 3000); };

  // Clic sur un livreur → partage GPS + ouverture de la conversation avec lui
  const onLivreurClick = (l) => {
    setSelectedId(l.id);
    if (pos) {
      getSocket()?.emit('client:click-livreur', { livreurId: l.id, clientLat: pos.lat, clientLng: pos.lng });
      showToast(`📍 Position envoyée à ${l.name}`);
    }
    setContact({ id: l.id, name: l.name, role: 'livreur' });
    setMsgOpen(true);
  };

  const openMessages = () => { setContact(null); setMsgOpen(true); };

  // ---------- Mes commandes (missions liées au compte du client) ----------
  const commandes = useMesCommandes();
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false); // liste « Livreurs proches »
  const activeOrders = commandes.orders.filter((o) => ['pending', 'accepted', 'en_cours'].includes(o.status)).length;
  const toRate = commandes.orders.filter((o) => o.status === 'livree' && !o.my_rating).length;
  const chatFromOrder = (c) => { setOrdersOpen(false); setContact(c); setMsgOpen(true); };

  return (
    <AppLayout title="Livreurs autour de moi" fill
      actions={<>
        <button onClick={() => setListOpen(true)} className="tk-chip" aria-label="Livreurs proches">
          <Bike size={14} /> Livreurs proches <span className="tk-count">{available.length}</span>
        </button>
        {delivering.length > 0 && <span className="tk-chip">{delivering.length} en livraison</span>}
        <button onClick={() => setOrdersOpen(true)} className="tk-chip" aria-label="Mes commandes">
          <ShoppingBag size={14} /> Mes commandes
          {(activeOrders + toRate) > 0 && <span className="tk-count">{activeOrders + toRate}</span>}
        </button>
        <button onClick={openMessages} className="tk-chip" aria-label="Mes messages">
          <MessageCircle size={14} /> Mes messages
          {unread > 0 && <span className="tk-count">{unread}</span>}
        </button>
      </>}>
      <div className="tk-fill relative flex">
        <div className="relative flex-1">
          <MapView center={pos} me={pos} livreurs={livreurs} onLivreurClick={onLivreurClick} selectedId={selectedId} />
          {error && <p className="absolute left-2 top-2 z-[500] rounded bg-white/90 px-2 py-1 text-xs shadow">{error}</p>}

          {/* Suivi en direct : distance client ↔ livreurs en cours de livraison */}
          {delivering.length > 0 && (
            <div className="tk-live-panel absolute right-3 top-3 z-[500] w-64 max-w-[calc(100%-24px)]">
              <p className="tk-kpi-label mb-1 flex items-center gap-1.5"><span className="tk-live-dot" /> Suivi en direct</p>
              <ul className="space-y-1">
                {delivering.slice(0, 4).map((l) => (
                  <li key={l.id}>
                    <button className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-gray-50" onClick={() => onLivreurClick(l)}>
                      <span className="truncate font-medium">{l.name}</span>
                      <span className="tk-money shrink-0">{formatDistance(l.distance_km)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {toast && <p className="absolute bottom-24 left-1/2 z-[500] -translate-x-1/2 rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow">{toast}</p>}
          {!msgOpen && (
            <p className="absolute bottom-4 left-2 right-20 z-[400] max-w-sm rounded-lg bg-white/95 p-2 text-center text-sm shadow md:hidden">
              Touchez un livreur pour partager votre position et discuter
            </p>
          )}

          {/* Bouton flottant "Mes messages" */}
          {!msgOpen && (
            <button onClick={openMessages} aria-label="Mes messages"
              className="absolute bottom-4 right-4 z-[500] flex h-14 w-14 items-center justify-center rounded-full bg-brand text-2xl text-white shadow-xl transition hover:scale-105 hover:bg-brand-dark">
              <MessageCircle size={24} />
              {unread > 0 && <span className="absolute -right-1 -top-1 min-w-[20px] rounded-full bg-red-600 px-1 text-xs font-bold">{unread}</span>}
            </button>
          )}
        </div>

        {/* Messagerie : fenêtre modale déplaçable */}
        {/* Mes commandes : fenêtre modale déplaçable */}
        <Modal open={ordersOpen} onClose={() => setOrdersOpen(false)} title="Mes commandes" icon={ShoppingBag} width={560}>
          <MesCommandes data={commandes} onChat={chatFromOrder} />
        </Modal>

        <Modal open={msgOpen} onClose={() => setMsgOpen(false)} title="Mes messages" icon={MessageCircle} width={900} bodyClassName="!p-0">
          <div className="h-[70vh]"><Messagerie initialContact={contact} showHeader={false} /></div>
        </Modal>
      </div>
      <Modal open={listOpen} onClose={() => setListOpen(false)} title="Livreurs proches" icon={Bike} width={460} bodyClassName="p-0">
        <div className="max-h-[65vh] overflow-y-auto">
          <LivreurList livreurs={available} origin={pos} actionLabel="Contacter"
            onAction={(l) => { setListOpen(false); onLivreurClick(l); }} />
        </div>
      </Modal>
    </AppLayout>
  );
}
