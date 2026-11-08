// Numéros burkinabè côté navigateur (même règle que server/services/phone.js).
const LOCAL_RE = /^[567]\d{7}$/;

/** Normalise : 8 chiffres ou null (accepte espaces, points, tirets, +226 / 00226) */
export function normalizePhone(raw) {
  const s = String(raw ?? '').trim();
  if (!s || !/^\+?[\d\s.()-]+$/.test(s)) return null;
  let d = s.replace(/\D/g, '');
  if (s.startsWith('+')) { if (!d.startsWith('226')) return null; d = d.slice(3); }
  else if (d.startsWith('00226')) d = d.slice(5);
  else if (d.length === 11 && d.startsWith('226')) d = d.slice(3);
  return LOCAL_RE.test(d) ? d : null;
}

/** « 70000001 » → « 70 00 00 01 » */
export const formatPhone = (p) => (p && /^\d{8}$/.test(p) ? p.replace(/(\d{2})(?=\d)/g, '$1 ') : p || '');

export const PHONE_HINT = '8 chiffres commençant par 5, 6 ou 7, avec ou sans +226';
