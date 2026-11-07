// « Mes commandes » (client) : missions dont le client connecté est le destinataire.
// GET /api/client/missions · temps réel (statuts, position du livreur) · notation du livreur.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bike, MessageCircle, Star, Store } from 'lucide-react';
import api, { errMsg } from '../api';
import { getSocket } from '../socket';
import { haversine, formatDistance } from '../geo';
import RateModal, { Stars } from './RateModal.jsx';

const STATUS_LABEL = { pending: 'En attente', accepted: 'Acceptée', en_cours: 'En route', livree: 'Livrée', refused: 'Refusée', annulee: 'Annulée' };
const STATUS_BADGE = { pending: 'tk-badge-warning', accepted: 'tk-badge-info', en_cours: 'tk-badge-info', livree: 'tk-badge-success', refused: 'tk-badge-danger', annulee: 'tk-badge-neutral' };
const ACTIVE = ['pending', 'accepted', 'en_cours'];
const fcfa = (n) => `${Number(n || 0).toLocaleString('fr-FR')} FCFA`;
const fmtDate = (iso) => (iso ? new Date(iso + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z')).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '·');

/** Hook : commandes du client + mises à jour temps réel (utilisable pour un badge) */
export function useMesCommandes() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get('/client/missions')
    .then((r) => { setOrders(r.data); setError(''); })
    .catch((e) => setError(errMsg(e)))
    .finally(() => setLoading(false)), []);

  useEffect(() => {
    load();
    const s = getSocket();
    if (!s) return;
    const reload = () => load();
    const onStatus = ({ missionId, status, mission }) =>
      setOrders((p) => (p.some((o) => o.id === missionId)
        ? p.map((o) => (o.id === missionId ? { ...o, status, completed_at: mission?.completed_at ?? o.completed_at } : o))
        : (load(), p)));
    // Position du livreur en direct pour les commandes en cours
    const onPos = ({ livreurId, lat, lng }) =>
      setOrders((p) => p.map((o) => (o.livreur_id === livreurId && ACTIVE.includes(o.status) ? { ...o, livreur_lat: lat, livreur_lng: lng } : o)));
    s.on('mission:new-client', reload);
    s.on('mission:completed-client', reload);
    s.on('mission:status-update', onStatus);
    s.on('livreur:position-update', onPos);
    return () => {
      s.off('mission:new-client', reload); s.off('mission:completed-client', reload);
      s.off('mission:status-update', onStatus); s.off('livreur:position-update', onPos);
    };
  }, [load]);

  return { orders, setOrders, loading, error, reload: load };
}

function OrderCard({ o, onRate, onChat }) {
  const live = ACTIVE.includes(o.status) && o.livreur_lat != null && o.client_lat != null;
  const dist = live ? haversine({ lat: o.livreur_lat, lng: o.livreur_lng }, { lat: o.client_lat, lng: o.client_lng }) : null;
  return (
    <li className="card space-y-1.5 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <b className="truncate">Commande #{o.id}</b>
        <span className={`badge shrink-0 ${STATUS_BADGE[o.status] || 'tk-badge-neutral'}`}>{STATUS_LABEL[o.status] || o.status}</span>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-600">
        <span className="inline-flex items-center gap-1"><Store size={14} /> {o.commercant_name}</span>
        <span className="inline-flex items-center gap-1"><Bike size={14} /> {o.livreur_name || '·'}</span>
        {o.delivery_price > 0 && <span className="tk-money">{fcfa(o.delivery_price)}</span>}
      </p>
      {live && (
        <div className="tk-detail-tile flex items-center justify-between !py-1.5">
          <span className="tk-kpi-label flex items-center gap-1.5"><span className="tk-live-dot" /> Livreur à</span>
          <span className="tk-money">{formatDistance(dist)}</span>
        </div>
      )}
      {o.order_details && <p className="tk-detail-tile whitespace-pre-wrap text-xs">{o.order_details}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <span className="text-xs text-gray-400">Créée le {fmtDate(o.created_at)}{o.completed_at ? ` · livrée le ${fmtDate(o.completed_at)}` : ''}</span>
        <div className="flex items-center gap-1.5">
          {o.status === 'livree' && o.livreur_id && (o.my_rating
            ? <span title="Votre note"><Stars value={o.my_rating} /></span>
            : <button className="btn-primary px-3 py-1 text-xs" onClick={() => onRate(o)}><Star size={14} /> Noter le livreur</button>)}
          {o.livreur_id && onChat && (
            <button className="btn-ghost px-3 py-1 text-xs" onClick={() => onChat({ id: o.livreur_id, name: o.livreur_name, role: 'livreur' })}>
              <MessageCircle size={14} /> Livreur
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** Contenu du panneau (onglets En cours / Livrées / Autres) */
export default function MesCommandes({ data, onChat }) {
  const { orders, setOrders, loading, error } = data;
  const [tab, setTab] = useState('active');
  const [rateMission, setRateMission] = useState(null);

  const groups = useMemo(() => ({
    active: orders.filter((o) => ACTIVE.includes(o.status)),
    done: orders.filter((o) => o.status === 'livree'),
    other: orders.filter((o) => ['refused', 'annulee'].includes(o.status))
  }), [orders]);
  const toRate = groups.done.filter((o) => !o.my_rating).length;
  const list = groups[tab];

  return (
    <div className="space-y-3">
      <div className="tk-pills tk-pills-block" role="tablist">
        {[['active', 'En cours', groups.active.length], ['done', 'Livrées', toRate], ['other', 'Annulées', 0]].map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {l}{n > 0 && <span className="tk-count">{n}</span>}
          </button>
        ))}
      </div>
      {tab === 'done' && toRate > 0 && <p className="tk-alert tk-alert-info">{toRate} commande(s) livrée(s) à noter.</p>}
      {error && <p className="tk-alert tk-alert-danger">{error}</p>}
      {loading && <p className="p-4 text-center text-sm text-gray-400">Chargement…</p>}
      {!loading && list.length === 0 && (
        <p className="p-6 text-center text-sm text-gray-500">
          {tab === 'active' ? 'Aucune commande en cours. Elles apparaissent ici quand un commerçant vous assigne une livraison.' : 'Aucune commande.'}
        </p>
      )}
      <ul className="space-y-2">
        {list.map((o) => <OrderCard key={o.id} o={o} onRate={setRateMission} onChat={onChat} />)}
      </ul>

      <RateModal mission={rateMission} onClose={() => setRateMission(null)}
        onDone={(id, rating) => { setOrders((p) => p.map((o) => (o.id === id ? { ...o, my_rating: rating } : o))); setRateMission(null); }} />
    </div>
  );
}
