// Notation des livreurs après une mission livrée.
//   POST /api/missions/:id/review   { rating: 1..5, comment? }
//   GET  /api/users/:id/reviews     → moyenne + derniers commentaires
const router = require('express').Router();
const { db, nowIso } = require('../db');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');

// Monté sur /api : l'authentification est appliquée route par route (pas de router.use global)

/** Résumé des notes d'un utilisateur (moyenne arrondie à 0,1, nombre, répartition 1..5) */
function reviewSummary(userId, limit = 10) {
  const agg = db.prepare('SELECT COUNT(*) AS count, AVG(rating) AS avg FROM reviews WHERE reviewee_id = ?').get(userId);
  const dist = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, 0]));
  for (const r of db.prepare('SELECT rating, COUNT(*) AS n FROM reviews WHERE reviewee_id = ? GROUP BY rating').all(userId)) dist[r.rating] = r.n;
  const latest = db.prepare(`
    SELECT r.id, r.mission_id, r.rating, r.comment, r.created_at, u.name AS reviewer_name
    FROM reviews r JOIN users u ON u.id = r.reviewer_id
    WHERE r.reviewee_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ?`).all(userId, limit);
  return {
    user_id: userId,
    count: agg.count,
    average: agg.count ? Math.round(agg.avg * 10) / 10 : null,
    distribution: dist,
    latest
  };
}

// POST /api/missions/:id/review
router.post('/missions/:id/review', requireAuth, requireActiveSubscription, (req, res) => {
  try {
    const missionId = Number(req.params.id);
    if (!Number.isInteger(missionId) || missionId <= 0) return res.status(400).json({ error: 'Identifiant de mission invalide' });

    // Validation de la note et du commentaire
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5)
      return res.status(400).json({ error: 'La note doit être un nombre entier entre 1 et 5' });
    const comment = req.body?.comment == null ? null : String(req.body.comment).trim();
    if (comment && comment.length > 1000) return res.status(400).json({ error: 'Commentaire : 1000 caractères maximum' });

    const m = db.prepare('SELECT * FROM missions WHERE id = ?').get(missionId);
    if (!m) return res.status(404).json({ error: 'Mission introuvable' });
    // Peuvent noter : le commerçant (donneur d'ordre) et le client destinataire de la mission
    if (m.commercant_id !== req.user.id && m.client_id !== req.user.id)
      return res.status(403).json({ error: 'Vous ne pouvez noter que vos propres missions' });
    if (m.status !== 'livree') return res.status(409).json({ error: 'Seule une mission livrée peut être notée' });
    if (!m.livreur_id) return res.status(409).json({ error: 'Aucun livreur associé à cette mission' });
    if (db.prepare('SELECT 1 FROM reviews WHERE mission_id = ? AND reviewer_id = ?').get(missionId, req.user.id))
      return res.status(409).json({ error: 'Vous avez déjà noté cette mission' });

    const { lastInsertRowid } = db.prepare(`INSERT INTO reviews (mission_id, reviewer_id, reviewee_id, rating, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(missionId, req.user.id, m.livreur_id, rating, comment || null, nowIso());
    const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(lastInsertRowid);
    const summary = reviewSummary(m.livreur_id, 0);
    // Le livreur est prévenu en temps réel (mise à jour de sa note moyenne)
    req.app.get('io')?.to(`user:${m.livreur_id}`).emit('review:new', { review, average: summary.average, count: summary.count });
    res.status(201).json({ review, average: summary.average, count: summary.count });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Vous avez déjà noté cette mission' });
    console.error('[review]', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/users/:id/reviews?limit=10
router.get('/users/:id/reviews', requireAuth, (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Identifiant invalide' });
    const u = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(userId);
    if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 0), 50);
    res.json({ name: u.name, role: u.role, ...reviewSummary(userId, limit) });
  } catch (e) {
    console.error('[reviews]', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
module.exports.reviewSummary = reviewSummary;
