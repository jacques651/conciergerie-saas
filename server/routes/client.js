// Espace client : livreurs visibles sur la carte.
const router = require('express').Router();
const { db, nowIso } = require('../db');
const { requireAuth, requireRole, requireActiveSubscription } = require('../middleware/auth');

router.use(requireAuth);

/** Livreurs en ligne ET abonnés (requête partagée avec l'espace commerçant) */
function onlineSubscribedLivreurs(statuses = ['en_ligne']) {
  const ph = statuses.map(() => '?').join(',');
  return db.prepare(`
    SELECT u.id, u.name, lp.status, lp.lat, lp.lng, lp.last_update
    FROM livreur_profiles lp JOIN users u ON u.id = lp.user_id
    WHERE lp.status IN (${ph}) AND lp.lat IS NOT NULL
      AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND s.expires_at > ?)`)
    .all(...statuses, nowIso());
}

// GET /api/client/livreurs
router.get('/livreurs', requireRole('client', 'commercant', 'admin'), requireActiveSubscription, (req, res) => {
  try { res.json(onlineSubscribedLivreurs(['en_ligne', 'en_livraison'])); } // en livraison : suivi en direct
  catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/client/missions → missions dont le client connecté est le destinataire (client_id = lui)
// Inclut la position live du livreur et la note déjà donnée par ce client.
router.get('/missions', requireRole('client'), requireActiveSubscription, (req, res) => {
  try {
    res.json(db.prepare(`
      SELECT m.id, m.status, m.client_name, m.client_phone, m.client_lat, m.client_lng, m.description, m.order_details,
             m.delivery_price, m.created_at, m.accepted_at, m.completed_at, m.livreur_id, m.commercant_id,
             c.name AS commercant_name, l.name AS livreur_name, lp.lat AS livreur_lat, lp.lng AS livreur_lng,
             r.rating AS my_rating
      FROM missions m
      JOIN users c ON c.id = m.commercant_id
      LEFT JOIN users l ON l.id = m.livreur_id
      LEFT JOIN livreur_profiles lp ON lp.user_id = m.livreur_id
      LEFT JOIN reviews r ON r.mission_id = m.id AND r.reviewer_id = @me
      WHERE m.client_id = @me
      ORDER BY m.created_at DESC, m.id DESC LIMIT 200`).all({ me: req.user.id }));
  } catch (e) { console.error('[client/missions]', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;
module.exports.onlineSubscribedLivreurs = onlineSubscribedLivreurs;
