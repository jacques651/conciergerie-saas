// Back-office admin (non soumis à l'abonnement).
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, nowIso, getActiveSubscription, getPrices, setSetting, PRICE_KEYS } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { activateSubscription } = require('../services/payment');
const { setAccountStatus, ACCOUNT_STATUSES } = require('../services/accounts');

router.use(requireAuth, requireRole('admin')); // toutes les routes admin sont réservées à l'admin

// --- Configuration des tarifs ------------------------------------
// GET /api/admin/settings → { price_daily, price_monthly, price_yearly }
router.get('/settings', requireRole('admin'), (req, res) => {
  try { res.json(getPrices()); }
  catch (e) { console.error('[settings]', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/admin/settings { price_daily, price_monthly, price_yearly }
router.post('/settings', requireRole('admin'), (req, res) => {
  try {
    const body = req.body || {};
    const updates = {};
    for (const key of PRICE_KEYS) {
      if (body[key] === undefined || body[key] === '') continue; // champ non fourni → inchangé
      const n = Number(body[key]);
      if (!Number.isInteger(n) || n <= 0)
        return res.status(400).json({ error: `${key} doit être un nombre entier positif (FCFA)` });
      if (n > 100000000) return res.status(400).json({ error: `${key} : montant trop élevé` });
      updates[key] = n;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Aucun tarif fourni' });
    db.transaction(() => { for (const [k, v] of Object.entries(updates)) setSetting(k, v); })();
    res.json({ ok: true, ...getPrices() });
  } catch (e) { console.error('[settings]', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

const wrap = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) { console.error('[admin]', e); res.status(e.status || 500).json({ error: e.message || 'Erreur serveur' }); }
};

// --- Recrutement -------------------------------------------------
router.get('/recruitment', wrap((req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare('SELECT * FROM recruitment_requests WHERE status = ? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM recruitment_requests ORDER BY created_at DESC').all();
  res.json(rows);
}));

// --- Validation des comptes (tous rôles) -------------------------
// GET /api/admin/accounts?status=pending|approved|rejected|all
router.get('/accounts', wrap((req, res) => {
  const status = req.query.status || 'pending';
  if (status !== 'all' && !ACCOUNT_STATUSES.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  const rows = db.prepare(`
    SELECT id, name, email, phone, role, status, created_at FROM users
    WHERE role != 'admin' ${status === 'all' ? '' : 'AND status = ?'}
    ORDER BY created_at DESC, id DESC LIMIT 1000`).all(...(status === 'all' ? [] : [status]));
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const r of db.prepare(`SELECT status, COUNT(*) AS n FROM users WHERE role != 'admin' GROUP BY status`).all()) counts[r.status] = r.n;
  res.json({ accounts: rows, counts });
}));

// POST /api/admin/accounts/:id/approve | /reject
for (const [action, status] of [['approve', 'approved'], ['reject', 'rejected']]) {
  router.post(`/accounts/:id/${action}`, wrap((req, res) => {
    const u = setAccountStatus(Number(req.params.id), status, req.app.get('io'));
    if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json({ ok: true, user: u });
  }));
}

router.post('/recruitment/:id/approve', wrap((req, res) => {
  const r = db.prepare('SELECT * FROM recruitment_requests WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Demande introuvable' });
  // Même logique que l'onglet « Demandes » : compte + profil livreur + demande synchronisés
  setAccountStatus(r.user_id, 'approved', req.app.get('io'));
  res.json({ ok: true });
}));

router.post('/recruitment/:id/reject', wrap((req, res) => {
  const r = db.prepare('SELECT * FROM recruitment_requests WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Demande introuvable' });
  setAccountStatus(r.user_id, 'rejected', req.app.get('io'));
  res.json({ ok: true });
}));

// --- Création manuelle d'un livreur (approuvé directement) -------
router.post('/livreurs', wrap((req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ error: 'email, password et name requis' });
  const mail = email.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail)) return res.status(409).json({ error: 'Email déjà utilisé' });
  const id = db.transaction(() => {
    const { lastInsertRowid } = db.prepare(`INSERT INTO users (email, password_hash, role, name, status) VALUES (?, ?, 'livreur', ?, 'approved')`)
      .run(mail, bcrypt.hashSync(password, 10), name.trim());
    db.prepare(`INSERT INTO livreur_profiles (user_id, status) VALUES (?, 'approved')`).run(lastInsertRowid);
    db.prepare(`INSERT INTO recruitment_requests (email, name, status, user_id) VALUES (?, ?, 'approved', ?)`).run(mail, name.trim(), lastInsertRowid);
    return lastInsertRowid;
  })();
  res.status(201).json({ id, email: mail, name, role: 'livreur' });
}));

// --- Utilisateurs ------------------------------------------------
router.get('/users', wrap((req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.status, u.created_at, lp.status AS livreur_status
    FROM users u LEFT JOIN livreur_profiles lp ON lp.user_id = u.id ORDER BY u.created_at DESC`).all();
  res.json(users.map((u) => {
    const s = u.role === 'admin' ? null : getActiveSubscription(u.id);
    return { ...u, subscription_active: u.role === 'admin' || !!s, subscription_expires_at: s?.expires_at || null };
  }));
}));

// --- Abonnements -------------------------------------------------
router.get('/subscriptions', wrap((req, res) => {
  const now = nowIso();
  const rows = db.prepare(`
    SELECT s.*, u.email, u.name, u.role,
      CASE WHEN s.status = 'active' AND s.expires_at <= ? THEN 'expired' ELSE s.status END AS effective_status
    FROM subscriptions s JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC`).all(now);
  const revenue = db.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM subscriptions WHERE status IN ('active','expired') AND payment_method != 'seed'`).get().t;
  const activeUsers = db.prepare(`SELECT COUNT(DISTINCT user_id) AS c FROM subscriptions WHERE status = 'active' AND expires_at > ?`).get(now).c;
  const expiringSoon = db.prepare(`SELECT COUNT(DISTINCT user_id) AS c FROM subscriptions WHERE status='active' AND expires_at > ? AND expires_at <= ?`)
    .get(now, new Date(Date.now() + 6 * 3600e3).toISOString()).c;
  res.json({ stats: { revenue, currency: 'XOF', activeUsers, expiringSoon, total: rows.length }, subscriptions: rows });
}));

// Activation manuelle (paiement Mobile Money reçu hors plateforme)
router.post('/subscriptions/:id/activate', wrap((req, res) => {
  const r = activateSubscription(Number(req.params.id), 'manual_admin');
  res.json(r);
}));

// Raccourci : créer + activer 24h pour un utilisateur donné
router.post('/users/:id/grant', wrap((req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const { lastInsertRowid } = db.prepare(`INSERT INTO subscriptions (user_id, amount, currency, status, plan, payment_method, transaction_ref)
    VALUES (?, ?, 'XOF', 'pending', 'daily', 'manual_admin', ?)`).run(u.id, getPrices().price_daily, `MANUAL-${Date.now()}`);
  res.json(activateSubscription(lastInsertRowid, 'manual_admin'));
}));

// --- Statistiques globales (tableau de bord) ---------------------
// GET /api/admin/stats
router.get('/stats', wrap((req, res) => {
  const now = nowIso();
  const MISSION_STATUSES = ['pending', 'accepted', 'en_cours', 'livree', 'refused', 'annulee'];
  const missionsByStatus = Object.fromEntries(MISSION_STATUSES.map((s) => [s, 0]));
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM missions GROUP BY status').all()) missionsByStatus[r.status] = r.n;
  const missionsTotal = Object.values(missionsByStatus).reduce((a, b) => a + b, 0);
  const deliveredValue = db.prepare(`SELECT COALESCE(SUM(delivery_price), 0) AS v FROM missions WHERE status = 'livree'`).get().v;

  const usersByRole = { admin: 0, client: 0, commercant: 0, livreur: 0 };
  for (const r of db.prepare('SELECT role, COUNT(*) AS n FROM users GROUP BY role').all()) usersByRole[r.role] = r.n;
  const usersTotal = Object.values(usersByRole).reduce((a, b) => a + b, 0);
  const livreursOnline = db.prepare(`SELECT COUNT(*) AS n FROM livreur_profiles WHERE status IN ('en_ligne','en_livraison')`).get().n;
  const livreursPending = db.prepare(`SELECT COUNT(*) AS n FROM livreur_profiles WHERE status = 'pending_approval'`).get().n;
  const accountsPending = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role != 'admin' AND status = 'pending'`).get().n;

  // Chiffre d'affaires des abonnements (hors abonnements de démonstration du seed)
  const paid = `status IN ('active','expired') AND payment_method != 'seed'`;
  const revenueTotal = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM subscriptions WHERE ${paid}`).get().v;
  const startOfMonth = new Date(); startOfMonth.setUTCDate(1); startOfMonth.setUTCHours(0, 0, 0, 0);
  const revenueMonth = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM subscriptions WHERE ${paid} AND created_at >= ?`).get(startOfMonth.toISOString()).v;
  const revenueByPlan = { daily: 0, monthly: 0, yearly: 0 };
  for (const r of db.prepare(`SELECT plan, COALESCE(SUM(amount), 0) AS v FROM subscriptions WHERE ${paid} GROUP BY plan`).all()) revenueByPlan[r.plan] = r.v;
  const activeSubscribers = db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM subscriptions WHERE status = 'active' AND expires_at > ?`).get(now).n;

  // Top 3 des livreurs (missions livrées), avec gains et note moyenne
  const topLivreurs = db.prepare(`
    SELECT u.id, u.name, COUNT(m.id) AS delivered, COALESCE(SUM(m.delivery_price), 0) AS earnings,
           (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.reviewee_id = u.id) AS rating,
           (SELECT COUNT(*) FROM reviews r WHERE r.reviewee_id = u.id) AS reviews
    FROM users u JOIN missions m ON m.livreur_id = u.id AND m.status = 'livree'
    WHERE u.role = 'livreur'
    GROUP BY u.id ORDER BY delivered DESC, earnings DESC LIMIT 3`).all();

  res.json({
    missions: { total: missionsTotal, byStatus: missionsByStatus, deliveredValue },
    users: { total: usersTotal, byRole: usersByRole, livreursOnline, livreursPending, accountsPending },
    revenue: { total: revenueTotal, month: revenueMonth, byPlan: revenueByPlan, activeSubscribers, currency: 'XOF' },
    topLivreurs
  });
}));

// --- Carte globale -----------------------------------------------
router.get('/livreurs/online', wrap((req, res) => {
  res.json(db.prepare(`SELECT u.id, u.name, lp.status, lp.lat, lp.lng, lp.last_update
    FROM livreur_profiles lp JOIN users u ON u.id = lp.user_id
    WHERE lp.status IN ('en_ligne','en_livraison') AND lp.lat IS NOT NULL`).all());
}));

module.exports = router;
