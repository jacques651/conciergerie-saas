// Middlewares d'authentification et d'autorisation.
const jwt = require('jsonwebtoken');
const { db, getActiveSubscription } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
// Sécurité : en production, un secret fort est obligatoire (sinon n'importe qui pourrait forger des jetons)
if (process.env.NODE_ENV === 'production' && !process.argv.includes('--dev') && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || JWT_SECRET === 'change-moi-en-production')) {
  console.error('❌ JWT_SECRET absent ou trop court (32 caractères minimum) : arrêt du serveur.');
  process.exit(1);
}

/** Message affiché pour un compte non approuvé */
function accountStatusMessage(status) {
  return status === 'rejected'
    ? "Votre demande d'inscription a été refusée."
    : "Votre compte est en attente d'approbation par l'administrateur.";
}

const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

const verifyToken = (token) => jwt.verify(token, JWT_SECRET);

/** Vérifie le JWT (header Authorization: Bearer xxx) → req.user */
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentification requise' });
  try {
    const payload = verifyToken(token);
    const user = db.prepare('SELECT id, email, role, name, status FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });
    // Compte non validé (ou refusé après coup) : accès bloqué même avec un jeton encore valide
    if (user.role !== 'admin' && user.status !== 'approved') {
      return res.status(403).json({ error: accountStatusMessage(user.status), code: 'ACCOUNT_' + String(user.status).toUpperCase() });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Jeton invalide ou expiré' });
  }
}

/** Restreint l'accès à un ou plusieurs rôles */
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Accès interdit pour ce rôle' });

/** Bloque si l'abonnement est expiré (HTTP 402). L'admin n'est jamais soumis. */
function isSubscribed(user) {
  return user.role === 'admin' || !!getActiveSubscription(user.id);
}
function requireActiveSubscription(req, res, next) {
  if (isSubscribed(req.user)) return next();
  return res.status(402).json({ error: 'Abonnement expiré ou inexistant', code: 'SUBSCRIPTION_REQUIRED' });
}

/** Pour les routes livreur : refuse tant que l'admin n'a pas validé le compte */
function requireApprovedLivreur(req, res, next) {
  const p = db.prepare('SELECT status FROM livreur_profiles WHERE user_id = ?').get(req.user.id);
  if (!p) return res.status(404).json({ error: 'Profil livreur introuvable' });
  if (p.status === 'pending_approval')
    return res.status(403).json({ error: 'Votre compte est en attente de validation', code: 'PENDING_APPROVAL' });
  next();
}

module.exports = {
  accountStatusMessage,
  signToken, verifyToken, requireAuth, requireRole,
  requireActiveSubscription, requireApprovedLivreur, isSubscribed
};
