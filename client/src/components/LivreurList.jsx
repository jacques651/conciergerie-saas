// Liste réutilisable des livreurs en ligne, triée du plus proche au plus éloigné.
// - livreurs : liste fournie par le parent (temps réel) ; sinon chargée via GET /api/livreurs/proches (rafraîchie toutes les 15 s)
// - origin   : {lat,lng} de l'utilisateur ; sinon navigator.geolocation
// - actionLabel + onAction : bouton principal (« Assigner une mission » / « Contacter ») ; onChat : bouton message
import { useEffect, useMemo, useState } from 'react';
import { Bike, MessageCircle, Send, Navigation } from 'lucide-react';
import api from '../api';

const rad = (d) => (d * Math.PI) / 180;
/** Distance Haversine en km */
export function haversineKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
/** 0.35 → "350 m" ; 1.234 → "1,2 km" */
export function fmtDistance(km) {
  if (km == null) return '—';
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km.toLocaleString('fr-FR', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

export default function LivreurList({ livreurs: given, origin, selectedId, onSelect, actionLabel, onAction, onChat }) {
  const [fetched, setFetched] = useState([]);
  const [geo, setGeo] = useState(null);

  // Chargement autonome si le parent ne fournit pas la liste
  useEffect(() => {
    if (given) return undefined;
    const load = () => api.get('/livreurs/proches').then((r) => setFetched(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [given]);

  // Position GPS autonome si le parent ne la fournit pas
  useEffect(() => {
    if (origin || !navigator.geolocation) return undefined;
    const id = navigator.geolocation.watchPosition((p) => setGeo({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { enableHighAccuracy: true, maximumAge: 10000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [origin]);

  const me = origin || geo;
  const list = useMemo(() => (given || fetched)
    .filter((l) => l.lat != null)
    .map((l) => ({ ...l, distance_km: haversineKm(me, l) ?? l.distance_km ?? null }))
    .sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9)), [given, fetched, me]);

  if (!list.length) return <p className="p-4 text-center text-sm text-gray-500">Aucun livreur en ligne pour le moment.</p>;
  return (
    <ul className="divide-y">
      {!me && <li className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500"><Navigation size={13} /> Activez votre position pour voir les distances.</li>}
      {list.map((l, i) => (
        <li key={l.id}
          className={`flex items-center gap-3 px-3 py-2.5 ${onSelect ? 'cursor-pointer hover:bg-gray-50' : ''} ${selectedId === l.id ? 'bg-brand-light' : ''}`}
          onClick={() => onSelect?.(l)}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
            {i === 0 && me ? <Bike size={17} /> : i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{l.name}</p>
            <p className="text-xs text-gray-500">
              <span className="tk-num font-semibold" style={{ color: 'var(--tk-accent-700)' }}>{fmtDistance(l.distance_km)}</span>
              {' · '}{l.status === 'en_livraison' ? 'En livraison' : 'Disponible'}
            </p>
          </div>
          {onChat && (
            <button onClick={(e) => { e.stopPropagation(); onChat(l); }} className="btn-ghost px-2 py-1.5" aria-label={`Écrire à ${l.name}`}>
              <MessageCircle size={16} />
            </button>
          )}
          {onAction && (
            <button onClick={(e) => { e.stopPropagation(); onAction(l); }} className="btn-primary shrink-0 px-3 py-1.5 text-xs">
              <Send size={13} /> {actionLabel}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
