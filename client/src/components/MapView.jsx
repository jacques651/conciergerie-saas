// Carte Leaflet / OpenStreetMap (aucune clé API).
import { useEffect, useRef, useState } from 'react';
import { haversine } from '../geo';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, Polyline } from 'react-leaflet';
import L from 'leaflet';

// Correctif Leaflet + Vite : les images des marqueurs par défaut sont introuvables
// une fois bundlées (→ « ? »). On force leur chargement depuis le CDN.
const CDN = 'https://unpkg.com/leaflet@1.9.4/dist/images/';
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: `${CDN}marker-icon-2x.png`,
  iconUrl: `${CDN}marker-icon.png`,
  shadowUrl: `${CDN}marker-shadow.png`
});

// Pictogrammes SVG inline (aucune dépendance aux emojis ni aux images)
const SVG = {
  scooter: '<path d="M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0zm10 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM9 17h6M7 15l2-5h4l3 5M13 10V7h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  pin: '<circle cx="12" cy="12" r="5" fill="currentColor"/>',
  shop: '<path d="M4 10h16v10H4zM3 10l2-5h14l2 5M10 20v-5h4v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  flag: '<path d="M6 21V4M6 4h11l-2 4 2 4H6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
};
const svgIcon = (shape, color, bg = 'var(--tk-surface)') =>
  L.divIcon({
    className: 'leaflet-div-icon',
    html: `<div style="background:${bg};color:${color};border:3px solid ${color};border-radius:9999px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35)"><svg viewBox="0 0 24 24" width="20" height="20">${SVG[shape]}</svg></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18]
  });

// Couleurs = jetons du thème Vert-ardoise (résolues par le navigateur dans le HTML des marqueurs)
export const ICONS = {
  livreur: svgIcon('scooter', 'var(--tk-accent-700)', 'var(--tk-surface)'),
  livraison: svgIcon('scooter', 'var(--tk-danger)', 'var(--tk-surface)'),
  me: svgIcon('pin', '#0369a1', '#e0f2fe'),
  shop: svgIcon('shop', 'var(--tk-accent-500)', 'var(--tk-surface)'),
  dest: svgIcon('flag', 'var(--tk-danger)', 'var(--tk-surface)')
};

function ClickHandler({ onClick }) {
  useMapEvents({ click: (e) => onClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function Recenter({ center }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView([center.lat, center.lng], map.getZoom()); }, [center?.lat, center?.lng]); // eslint-disable-line
  return null;
}

// ---------- Suivi en direct : tracé des positions successives ----------
const TRAIL_MAX_POINTS = 300;   // points conservés par livreur
const TRAIL_MIN_STEP_KM = 0.005; // on ignore les déplacements < 5 m (bruit GPS)

/**
 * Mémorise les positions successives de chaque point suivi ({ id, lat, lng }).
 * Un tracé est effacé dès que le point n'est plus suivi (ex. livraison terminée).
 */
function useTrails(points) {
  const trails = useRef(new Map()); // id → [[lat, lng], ...]
  const [, force] = useState(0);
  const key = points.map((p) => `${p.id}:${p.lat?.toFixed(6)},${p.lng?.toFixed(6)}`).join('|');

  useEffect(() => {
    let changed = false;
    const ids = new Set(points.map((p) => String(p.id)));
    for (const id of [...trails.current.keys()]) {
      if (!ids.has(id)) { trails.current.delete(id); changed = true; }
    }
    for (const p of points) {
      if (p.lat == null || p.lng == null) continue;
      const id = String(p.id);
      const t = trails.current.get(id) || [];
      const last = t[t.length - 1];
      if (!last || haversine({ lat: last[0], lng: last[1] }, p) >= TRAIL_MIN_STEP_KM) {
        // Nouveau tableau à chaque ajout : react-leaflet ne redessine la Polyline que si la référence change
        trails.current.set(id, [...t, [p.lat, p.lng]].slice(-TRAIL_MAX_POINTS));
        changed = true;
      }
    }
    if (changed) force((n) => n + 1);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return [...trails.current.entries()].filter(([, t]) => t.length >= 2);
}

/**
 * props :
 *  center {lat,lng}, me {lat,lng,icon,label,track?}, livreurs [], onLivreurClick(l),
 *  onMapClick({lat,lng}), extraMarkers [{id,lat,lng,icon,label}], lines [[ [lat,lng],[lat,lng] ]]
 *  tracked [{id,lat,lng}] : points supplémentaires dont on trace le parcours
 *  selectedId, recenter (bool)
 * Les livreurs au statut "en_livraison" sont toujours tracés automatiquement.
 */
export default function MapView({
  center, me, livreurs = [], onLivreurClick, onMapClick, extraMarkers = [], lines = [], tracked = [], selectedId, recenter = false, zoom = 14
}) {
  const c = center || me || { lat: 12.3714, lng: -1.5197 };
  const trails = useTrails([
    ...livreurs.filter((l) => l.status === 'en_livraison').map((l) => ({ id: `l${l.id}`, lat: l.lat, lng: l.lng })),
    ...tracked.map((t) => ({ ...t, id: `t${t.id}` })),
    ...(me?.track ? [{ id: 'me', lat: me.lat, lng: me.lng }] : [])
  ]);
  return (
    <MapContainer center={[c.lat, c.lng]} zoom={zoom} scrollWheelZoom className="h-full w-full">
      <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {recenter && <Recenter center={c} />}
      {onMapClick && <ClickHandler onClick={onMapClick} />}

      {me && (
        <Marker position={[me.lat, me.lng]} icon={me.icon || ICONS.me}>
          <Popup>{me.label || 'Vous êtes ici'}</Popup>
        </Marker>
      )}

      {livreurs.filter((l) => l.lat != null).map((l) => (
        <Marker key={l.id} position={[l.lat, l.lng]}
          icon={l.status === 'en_livraison' ? ICONS.livraison : ICONS.livreur}
          opacity={selectedId && selectedId !== l.id ? 0.6 : 1}
          eventHandlers={{ click: () => onLivreurClick?.(l) }}>
          <Popup>
            <b>{l.name}</b><br />
            {l.status === 'en_livraison' ? 'En livraison' : 'Disponible'}
            {l.distance_km != null && <><br />{l.distance_km} km</>}
          </Popup>
        </Marker>
      ))}

      {extraMarkers.map((m) => (
        <Marker key={m.id} position={[m.lat, m.lng]} icon={m.icon || ICONS.dest}>
          {m.label && <Popup>{m.label}</Popup>}
        </Marker>
      ))}

      {lines.map((ln, i) => <Polyline key={i} positions={ln} pathOptions={{ color: '#0f766e', dashArray: '6 8' }} />)}

      {/* Parcours réel des livreurs en livraison (positions successives) */}
      {trails.map(([id, pts]) => (
        <Polyline key={`trail-${id}`} positions={pts} pathOptions={{ color: '#14b8a6', weight: 4, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }} />
      ))}
    </MapContainer>
  );
}
