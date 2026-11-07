// Espace commerçant : livreurs les plus proches, création et suivi des missions, chat.
import { useEffect, useMemo, useState } from 'react';
import api, { errMsg } from '../api';
import { getSocket } from '../socket';
import AppLayout from '../components/AppLayout.jsx';
import { Map as MapIcon, PanelRight, MessageCircle, Phone, Bike, Star, Navigation } from 'lucide-react';
import RateModal, { Stars } from '../components/RateModal.jsx';
import { haversine as hv, formatDistance } from '../geo';
import MapView, { ICONS } from '../components/MapView.jsx';
import LivreurList from '../components/LivreurList.jsx';
import MissionForm from '../components/MissionForm.jsx';
import Messagerie from '../components/Messagerie.jsx';
import { useGeolocation, useLiveLivreurs, useUnreadMessages } from '../hooks';
import { useAuth } from '../auth.jsx';

// Haversine côté client pour retrier en direct lors des mises à jour socket
const R = 6371, rad = (d) => (d * Math.PI) / 180;
const haversine = (a, b) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const STATUS_LABEL = { pending: 'En attente', accepted: 'Acceptée', refused: 'Refusée', en_cours: 'En cours', livree: 'Terminée', annulee: 'Annulée' };
const STATUS_BADGE = { pending: 'tk-badge-warning', accepted: 'tk-badge-info', en_cours: 'tk-badge-info', livree: 'tk-badge-success', refused: 'tk-badge-danger', annulee: 'tk-badge-neutral' };
const fcfa = (n) => `${Number(n || 0).toLocaleString('fr-FR')} FCFA`;
const fmtDate = (iso) => (iso ? new Date(iso + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z')).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '·');

// Filtres de l'historique (missions passées)
const HISTORY_FILTERS = [
  ['livree,refused,annulee', 'Toutes'],
  ['livree', 'Terminées'],
  ['refused', 'Refusées'],
  ['annulee', 'Annulées']
];

/** Carte de mission (suivi et historique) */
function MissionCard({ m, onChat, onRate, shop }) {
  // Distances en temps réel pendant la livraison (position livreur mise à jour par socket)
  const live = ['accepted', 'en_cours'].includes(m.status) && m.livreur_lat != null;
  const toClient = live && m.client_lat != null ? hv({ lat: m.livreur_lat, lng: m.livreur_lng }, { lat: m.client_lat, lng: m.client_lng }) : null;
  const toShop = live && shop ? hv({ lat: m.livreur_lat, lng: m.livreur_lng }, shop) : null;
  return (
    <li className="card space-y-1.5 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <b className="truncate">#{m.id} · {m.client_name}</b>
        <span className={`badge shrink-0 ${STATUS_BADGE[m.status] || 'tk-badge-neutral'}`}>{STATUS_LABEL[m.status] || m.status}</span>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-600">
        <span className="inline-flex items-center gap-1"><Bike size={14} /> {m.livreur_name || '·'}</span>
        <span className="inline-flex items-center gap-1"><Phone size={14} /> {m.client_phone}</span>
        {m.delivery_price > 0 && <span className="tk-money">{fcfa(m.delivery_price)}</span>}
      </p>
      {live && (
        <div className="grid grid-cols-2 gap-2">
          <div className="tk-detail-tile !py-1.5"><p className="tk-kpi-label flex items-center gap-1"><span className="tk-live-dot" /> Livreur → client</p><p className="tk-money">{formatDistance(toClient)}</p></div>
          <div className="tk-detail-tile !py-1.5"><p className="tk-kpi-label">Livreur → boutique</p><p className="tk-money">{formatDistance(toShop)}</p></div>
        </div>
      )}
      {m.order_details && <p className="tk-detail-tile whitespace-pre-wrap text-xs">{m.order_details}</p>}
      {m.description && <p className="text-gray-500">{m.description}</p>}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="text-xs text-gray-400">Créée le {fmtDate(m.created_at)}{m.completed_at ? ` · livrée le ${fmtDate(m.completed_at)}` : ''}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {m.status === 'livree' && m.livreur_id && (m.my_rating
            ? <span className="inline-flex items-center gap-1 text-xs" title="Votre note"><Stars value={m.my_rating} /></span>
            : onRate && <button className="btn-primary px-3 py-1 text-xs" onClick={() => onRate(m)}><Star size={14} /> Noter le livreur</button>)}
          {m.livreur_id && onChat && (
            <button className="btn-ghost px-3 py-1 text-xs" onClick={() => onChat({ id: m.livreur_id, name: m.livreur_name, role: 'livreur' })}>
              <MessageCircle size={14} /> Livreur
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export default function DashboardCommercant() {
  const { user } = useAuth();
  const { pos, error } = useGeolocation();
  const [raw] = useLiveLivreurs(
    () => (pos ? api.get('/commercant/livreurs', { params: pos }).then((r) => r.data) : Promise.resolve([])),
    [pos?.lat, pos?.lng]
  );
  const [selected, setSelected] = useState(null);
  const [dest, setDest] = useState(null);
  const [missions, setMissions] = useState([]);
  const [tab, setTab] = useState('livreurs');
  const [contact, setContact] = useState(null); // conversation à ouvrir dans l'onglet Messages
  const [panelOpen, setPanelOpen] = useState(true); // mobile
  const unread = useUnreadMessages(user.id, tab === 'messages');
  const openChat = (c) => { setContact(c); setTab('messages'); setPanelOpen(true); };
  const [rateMission, setRateMission] = useState(null); // mission en cours de notation

  // ---------- Historique (GET /api/commercant/historique) ----------
  const [histFilter, setHistFilter] = useState(HISTORY_FILTERS[0][0]);
  const [history, setHistory] = useState({ missions: [], stats: { count: 0, delivered_total: 0 } });
  const [histLoading, setHistLoading] = useState(false);
  const loadHistory = () => {
    setHistLoading(true);
    return api.get('/commercant/historique', { params: { status: histFilter } })
      .then((r) => setHistory(r.data)).catch(() => {}).finally(() => setHistLoading(false));
  };
  useEffect(() => { if (tab === 'historique') loadHistory(); }, [tab, histFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Livreurs disponibles triés par distance (recalculée à chaque mise à jour)
  const livreurs = useMemo(() => (pos ? raw
    .filter((l) => l.status === 'en_ligne')
    .map((l) => ({ ...l, distance_km: Math.round(haversine(pos, l) * 100) / 100 }))
    .sort((a, b) => a.distance_km - b.distance_km) : []), [raw, pos]);

  const loadMissions = () => api.get('/commercant/missions').then((r) => setMissions(r.data)).catch(() => {});
  useEffect(() => { loadMissions(); }, []);

  // Suivi temps réel : statut des missions + position des livreurs assignés
  useEffect(() => {
    const s = getSocket();
    const onStatus = ({ missionId, status, mission }) =>
      setMissions((p) => p.map((m) => (m.id === missionId ? { ...m, ...(mission || {}), livreur_name: m.livreur_name, status } : m)));
    const onPos = ({ livreurId, lat, lng }) => setMissions((p) => p.map((m) => (m.livreur_id === livreurId ? { ...m, livreur_lat: lat, livreur_lng: lng } : m)));
    s?.on('mission:status-update', onStatus);
    s?.on('livreur:position-update', onPos);
    return () => { s?.off('mission:status-update', onStatus); s?.off('livreur:position-update', onPos); };
  }, []);

  const active = missions.filter((m) => ['pending', 'accepted', 'en_cours'].includes(m.status));

  const extra = [
    ...(dest ? [{ id: 'dest', ...dest, icon: ICONS.dest, label: 'Adresse de livraison' }] : []),
    ...active.filter((m) => m.livreur_lat != null && !livreurs.some((l) => l.id === m.livreur_id))
      .map((m) => ({ id: `lv${m.id}`, lat: m.livreur_lat, lng: m.livreur_lng, icon: ICONS.livraison, label: `${m.livreur_name} – mission #${m.id}` })),
    ...active.filter((m) => m.client_lat != null && tab === 'missions')
      .map((m) => ({ id: `d${m.id}`, lat: m.client_lat, lng: m.client_lng, icon: ICONS.dest, label: `#${m.id} ${m.client_name}` }))
  ];
  const lines = active.filter((m) => m.livreur_lat != null && m.client_lat != null)
    .map((m) => [[m.livreur_lat, m.livreur_lng], [m.client_lat, m.client_lng]]);

  return (
    <AppLayout title="Espace commerçant" fill
      actions={<>
        <span className="tk-chip">{livreurs.length} livreur(s) disponible(s)</span>
        <button className="tk-chip md:hidden" onClick={() => setPanelOpen((v) => !v)}>
          {panelOpen ? <><MapIcon size={14} /> Carte</> : <><PanelRight size={14} /> Panneau</>}
        </button>
      </>}>
      <div className="tk-fill relative flex">
        <div className="relative flex-1">
          <MapView center={pos} me={pos && { ...pos, icon: ICONS.shop, label: 'Ma boutique' }}
            livreurs={livreurs} selectedId={selected?.id}
            onLivreurClick={(l) => { setSelected(l); setTab('nouvelle'); setPanelOpen(true); }}
            onMapClick={(p) => { setDest(p); if (tab !== 'nouvelle') setTab('nouvelle'); }}
            extraMarkers={extra} lines={lines}
            tracked={active.filter((m) => m.status === 'en_cours' && m.livreur_lat != null).map((m) => ({ id: m.livreur_id, lat: m.livreur_lat, lng: m.livreur_lng }))} />
          {error && <p className="absolute left-2 top-2 z-[500] rounded bg-white/90 px-2 py-1 text-xs shadow">{error}</p>}
        </div>

        <aside className={`${panelOpen ? 'flex' : 'hidden'} absolute inset-x-0 bottom-0 z-[600] h-[65%] flex-col rounded-t-2xl bg-white shadow-2xl md:static md:z-auto md:flex md:h-auto ${tab === 'messages' ? 'md:w-[680px] lg:w-[760px]' : 'md:w-[420px]'} md:rounded-none md:border-l md:shadow-none`}>
          <div className="border-b p-2">
           <div className="tk-pills tk-pills-block tk-pills-compact" role="tablist">
            {[['livreurs', 'Livreurs', livreurs.length], ['nouvelle', 'Mission', 0], ['missions', 'Suivi', active.length], ['historique', 'Historique', 0], ['messages', 'Messages', unread]].map(([k, l, n]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); if (k === 'messages') setContact(null); }}>
                {l}
                {n > 0 && <span className="tk-count">{n}</span>}
              </button>
            ))}
           </div>
          </div>
          <div className={`min-h-0 flex-1 ${tab === 'messages' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
            {tab === 'messages' ? (
              <Messagerie initialContact={contact} />
            ) : tab === 'livreurs' ? (
              <LivreurList livreurs={livreurs} selectedId={selected?.id}
                onSelect={(l) => { setSelected(l); setTab('nouvelle'); }} />
            ) : tab === 'nouvelle' ? (
              <MissionForm livreur={selected} destination={dest}
                onCreated={(m) => { setMissions((p) => [{ ...m, livreur_name: selected.name, livreur_lat: selected.lat, livreur_lng: selected.lng }, ...p]); setDest(null); setSelected(null); setTab('missions'); }} />
            ) : tab === 'historique' ? (
              <div className="space-y-2 bg-gray-50 p-2">
                <div className="tk-pills tk-pills-block" role="tablist">
                  {HISTORY_FILTERS.map(([v, l]) => (
                    <button key={v} role="tab" aria-selected={histFilter === v} onClick={() => setHistFilter(v)}>{l}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="tk-kpi !p-3"><div><p className="tk-kpi-label">Missions</p><p className="tk-kpi-value">{history.stats.count}</p></div></div>
                  <div className="tk-kpi !p-3"><div><p className="tk-kpi-label">Frais livrés</p><p className="tk-kpi-value">{fcfa(history.stats.delivered_total)}</p></div></div>
                </div>
                {histLoading && <p className="p-4 text-center text-sm text-gray-400">Chargement…</p>}
                {!histLoading && history.missions.length === 0 && <p className="p-4 text-center text-sm text-gray-500">Aucune mission dans l'historique.</p>}
                <ul className="space-y-2">
                  {history.missions.map((m) => <MissionCard key={m.id} m={m} onChat={openChat} onRate={setRateMission} />)}
                </ul>
              </div>
            ) : (
              <ul className="space-y-2 bg-gray-50 p-2">
                {active.length === 0 && <p className="p-4 text-center text-sm text-gray-500">Aucune mission en cours. Les missions terminées sont dans l'onglet Historique.</p>}
                {active.map((m) => <MissionCard key={m.id} m={m} onChat={openChat} shop={pos} />)}
              </ul>
            )}
          </div>
        </aside>
      </div>
      <RateModal mission={rateMission} onClose={() => setRateMission(null)}
        onDone={(id, rating) => {
          setHistory((h) => ({ ...h, missions: h.missions.map((m) => (m.id === id ? { ...m, my_rating: rating } : m)) }));
          setRateMission(null);
        }} />
    </AppLayout>
  );
}
