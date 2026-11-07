// Calculs géographiques côté navigateur (même formule que server/services/geo.js).
const R = 6371; // rayon terrestre moyen (km)
const rad = (d) => (d * Math.PI) / 180;

/** Distance à vol d'oiseau en km entre deux points {lat, lng} */
export function haversine(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 0.35 → « 350 m », 2.456 → « 2,46 km » */
export function formatDistance(km) {
  if (km == null || Number.isNaN(km)) return '·';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toLocaleString('fr-FR', { maximumFractionDigits: km < 10 ? 2 : 1 })} km`;
}
