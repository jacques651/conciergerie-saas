// GET /api/livreurs/proches — livreurs en ligne (et abonnés) avec position, pour clients ET commerçants.
// Le tri par distance est fait côté frontend (position GPS du navigateur).
const router = require('express').Router();
const { requireAuth, requireRole, requireActiveSubscription } = require('../middleware/auth');
const { onlineSubscribedLivreurs } = require('./client');

router.get('/proches', requireAuth, requireRole('client', 'commercant', 'admin'), requireActiveSubscription, (req, res) => {
  try { res.json(onlineSubscribedLivreurs(['en_ligne'])); }
  catch (e) { console.error('[livreurs/proches]', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;
