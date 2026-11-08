// Numéros de téléphone burkinabè.
// Formats acceptés : 8 chiffres commençant par 5, 6 ou 7 (ex. 70 00 00 01, 70.00.00.01, 70-00-00-01)
// ou avec l'indicatif : +226 70 00 00 01, 00226…, 226… (11 chiffres).
// Forme canonique stockée en base : 8 chiffres sans séparateur (ex. "70000001").

const LOCAL_RE = /^[567]\d{7}$/;

/** Normalise un numéro ; retourne les 8 chiffres ou null si invalide */
function normalizePhone(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Seuls chiffres, espaces, points, tirets, parenthèses et un « + » initial sont tolérés
  if (!/^\+?[\d\s.()-]+$/.test(s)) return null;
  let digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) {
    if (!digits.startsWith('226')) return null; // indicatif étranger : refusé
    digits = digits.slice(3);
  } else if (digits.startsWith('00226')) digits = digits.slice(5);
  else if (digits.length === 11 && digits.startsWith('226')) digits = digits.slice(3);
  return LOCAL_RE.test(digits) ? digits : null;
}

/** « 70000001 » → « 70 00 00 01 » */
const formatPhone = (p) => (p && /^\d{8}$/.test(p) ? p.replace(/(\d{2})(?=\d)/g, '$1 ') : p || null);

const PHONE_FORMAT_MESSAGE = 'Numéro de téléphone invalide : saisissez 8 chiffres commençant par 5, 6 ou 7 (ex : 70 12 34 56), ou +226 suivi de ces 8 chiffres';

module.exports = { normalizePhone, formatPhone, PHONE_FORMAT_MESSAGE };
