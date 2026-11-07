// Espace livreur : statut, position, missions.
const router = require('express').Router();
const { db, nowIso } = require('../db');
const { emitMissionStatus } = require('../services/missionEvents');
const { requireAuth, requireRole, requireActiveSubscription, requireApprovedLivreur } = require('../middleware/auth');

router.use(requireAuth, requireRole('livreur'));

// Profil (accessible même en attente / sans abonnement → pour afficher l'état)
router.get('/me', (req, res) => {
  const p = db.prepare('SELECT * FROM livreur_profiles WHERE user_id = ?').get(req.user.id);
  if (!p) return res.status(404).json({ error: 'Profil introuvable' });
  res.json(p);
});

router.use(requireApprovedLivreur, requireActiveSubscription);

const ALLOWED = ['en_ligne', 'hors_ligne', 'en_livraison'];

// PUT /api/livreur/status { status }
router.put('/status', (req, res) => {
  try {
    const { status } = req.body || {};
    if (!ALLOWED.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
    db.prepare('UPDATE livreur_profiles SET status = ?, last_update = ? WHERE user_id = ?').run(status, nowIso(), req.user.id);
    const p = db.prepare('SELECT * FROM livreur_profiles WHERE user_id = ?').get(req.user.id);
    const io = req.app.get('io');
    if (status === 'hors_ligne') io?.to('realtime').emit('livreur:offline', { livreurId: req.user.id });
    else if (p.lat != null) io?.to('realtime').emit('livreur:position-update', { livreurId: req.user.id, name: req.user.name, lat: p.lat, lng: p.lng, status });
    res.json(p);
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/livreur/stats → missions terminées et gains (total + aujourd'hui)
// Une mission terminée a le statut "livree" (date de fin : completed_at).
router.get('/stats', (req, res) => {
  try {
    const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0); // Burkina Faso = UTC+0
    const row = db.prepare(`
      SELECT COUNT(*) AS completed_count,
             COALESCE(SUM(delivery_price), 0) AS total_earnings,
             COALESCE(SUM(CASE WHEN completed_at >= @day THEN 1 ELSE 0 END), 0) AS today_count,
             COALESCE(SUM(CASE WHEN completed_at >= @day THEN delivery_price ELSE 0 END), 0) AS today_earnings
      FROM missions WHERE livreur_id = @me AND status = 'livree'`).get({ me: req.user.id, day: startOfDay.toISOString() });
    res.json({ ...row, currency: 'XOF' });
  } catch (e) { console.error('[livreur/stats]', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/livreur/historique → missions terminées du livreur, avec gains et notes reçues
router.get('/historique', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT m.id, m.status, m.client_name, m.client_phone, m.order_details, m.description, m.delivery_price,
             m.created_at, m.completed_at, c.name AS commercant_name,
             (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.mission_id = m.id AND r.reviewee_id = m.livreur_id) AS rating,
             (SELECT COUNT(*) FROM reviews r WHERE r.mission_id = m.id AND r.reviewee_id = m.livreur_id) AS review_count
      FROM missions m JOIN users c ON c.id = m.commercant_id
      WHERE m.livreur_id = ? AND m.status = 'livree'
      ORDER BY m.completed_at DESC, m.id DESC LIMIT 300`).all(req.user.id);
    const reviewsStmt = db.prepare(`
      SELECT r.rating, r.comment, u.name AS reviewer_name, u.role AS reviewer_role
      FROM reviews r JOIN users u ON u.id = r.reviewer_id WHERE r.mission_id = ? AND r.reviewee_id = ? ORDER BY r.id`);
    for (const m of rows) m.reviews = m.review_count ? reviewsStmt.all(m.id, req.user.id) : [];
    const total = rows.reduce((a, m) => a + (m.delivery_price || 0), 0);
    res.json({ missions: rows, stats: { count: rows.length, earnings: total } });
  } catch (e) { console.error('[livreur/historique]', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/livreur/missions
router.get('/missions', (req, res) => {
  res.json(db.prepare(`SELECT m.*, u.name AS commercant_name FROM missions m JOIN users u ON u.id = m.commercant_id
    WHERE m.livreur_id = ? ORDER BY m.created_at DESC LIMIT 100`).all(req.user.id));
});

// Logique commune des transitions de mission
function missionTransition(req, res, action) {
  try {
    const m = db.prepare('SELECT * FROM missions WHERE id = ? AND livreur_id = ?').get(req.params.id, req.user.id);
    if (!m) return res.status(404).json({ error: 'Mission introuvable' });
    const now = nowIso();
    const map = {
      accept:   ['pending',  'accepted', 'accepted_at'],
      refuse:   ['pending',  'refused',  null],
      start:    ['accepted', 'en_cours', null],
      complete: ['en_cours', 'livree',   'completed_at']
    };
    const t = map[action];
    if (!t) return res.status(400).json({ error: 'Action invalide' });
    if (m.status !== t[0]) return res.status(409).json({ error: `Transition impossible depuis "${m.status}"` });
    db.prepare(`UPDATE missions SET status = ?${t[2] ? `, ${t[2]} = ?` : ''} WHERE id = ?`)
      .run(...(t[2] ? [t[1], now, m.id] : [t[1], m.id]));
    if (action === 'start') db.prepare(`UPDATE livreur_profiles SET status='en_livraison' WHERE user_id=?`).run(req.user.id);
    if (action === 'complete') db.prepare(`UPDATE livreur_profiles SET status='en_ligne' WHERE user_id=?`).run(req.user.id);
    const updated = db.prepare('SELECT * FROM missions WHERE id = ?').get(m.id);
    emitMissionStatus(req.app.get('io'), m.id); // commerçant + client lié (+ "…completed" si livrée)
    res.json(updated);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
}

// PUT /api/livreur/missions/:id { action: accept|refuse|start|complete }
router.put('/missions/:id', (req, res) => missionTransition(req, res, req.body?.action));

// Raccourcis explicites : POST /api/livreur/missions/:id/accept|refuse|start|complete
for (const action of ['accept', 'refuse', 'start', 'complete']) {
  router.post(`/missions/:id/${action}`, (req, res) => missionTransition(req, res, action));
}

module.exports = router;
