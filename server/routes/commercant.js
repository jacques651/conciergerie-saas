// Espace commerçant : livreurs les plus proches + missions.
const router = require('express').Router();
const { db } = require('../db');
const { haversine } = require('../services/geo');
const { requireAuth, requireRole, requireActiveSubscription } = require('../middleware/auth');
const { onlineSubscribedLivreurs } = require('./client');
const { emitMissionCreated, emitMissionStatus } = require('../services/missionEvents');

router.use(requireAuth, requireRole('commercant'), requireActiveSubscription);

// GET /api/commercant/livreurs?lat=..&lng=.. → triés par distance croissante
router.get('/livreurs', (req, res) => {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return res.status(400).json({ error: 'lat et lng requis' });
  const list = onlineSubscribedLivreurs()
    .map((l) => ({ ...l, distance_km: Math.round(haversine(lat, lng, l.lat, l.lng) * 100) / 100 }))
    .sort((a, b) => a.distance_km - b.distance_km);
  res.json(list);
});

// GET /api/commercant/clients → comptes clients de la plateforme (pour lier une mission)
router.get('/clients', (req, res) => {
  try {
    res.json(db.prepare(`SELECT id, name, email, phone FROM users WHERE role = 'client' ORDER BY name COLLATE NOCASE LIMIT 1000`).all());
  } catch (e) { console.error('[commercant/clients]', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/commercant/missions
router.post('/missions', (req, res) => {
  try {
    const { livreur_id, client_lat, client_lng, description, order_details } = req.body || {};
    let { client_name, client_phone } = req.body || {};

    // Client de la plateforme (facultatif) : nom et téléphone repris de son compte
    let client_id = null;
    if (req.body?.client_id != null && req.body.client_id !== '') {
      client_id = Number(req.body.client_id);
      const cu = Number.isInteger(client_id) && db.prepare(`SELECT id, name, phone FROM users WHERE id = ? AND role = 'client'`).get(client_id);
      if (!cu) return res.status(404).json({ error: 'Client introuvable' });
      client_name = cu.name;
      // Téléphone du compte en priorité ; à défaut, celui saisi par le commerçant
      client_phone = cu.phone || client_phone;
      if (!client_phone) return res.status(400).json({ error: "Ce client n'a pas de téléphone enregistré : saisissez-le" });
    }
    client_name = String(client_name || '').trim();
    client_phone = String(client_phone || '').trim();
    if (!livreur_id || !client_name || !client_phone || client_lat == null || client_lng == null)
      return res.status(400).json({ error: 'livreur, client (nom et téléphone) et adresse (clic carte) requis' });
    // Frais de livraison : entier >= 0 (FCFA), facultatif
    const raw = req.body?.delivery_price;
    const delivery_price = raw === undefined || raw === '' || raw === null ? 0 : Number(raw);
    if (!Number.isInteger(delivery_price) || delivery_price < 0 || delivery_price > 10000000)
      return res.status(400).json({ error: 'Frais de livraison : nombre entier positif (FCFA)' });
    if (order_details && String(order_details).length > 2000)
      return res.status(400).json({ error: 'Détails de la commande : 2000 caractères maximum' });
    const l = db.prepare(`SELECT status FROM livreur_profiles WHERE user_id = ?`).get(livreur_id);
    if (!l) return res.status(404).json({ error: 'Livreur introuvable' });
    if (l.status !== 'en_ligne') return res.status(409).json({ error: "Ce livreur n'est pas disponible" });

    const { lastInsertRowid } = db.prepare(`INSERT INTO missions
      (commercant_id, livreur_id, client_id, client_name, client_phone, client_lat, client_lng, description, order_details, delivery_price, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
      .run(req.user.id, livreur_id, client_id, client_name, client_phone, client_lat, client_lng, description || '',
        order_details ? String(order_details).trim() : null, delivery_price);
    // Notification temps réel : livreur ("mission:new") + client lié ("mission:new-client")
    const mission = emitMissionCreated(req.app.get('io'), lastInsertRowid);
    res.status(201).json(mission);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/commercant/missions (avec position live du livreur)
router.get('/missions', (req, res) => {
  res.json(db.prepare(`
    SELECT m.*, u.name AS livreur_name, lp.lat AS livreur_lat, lp.lng AS livreur_lng
    FROM missions m LEFT JOIN users u ON u.id = m.livreur_id LEFT JOIN livreur_profiles lp ON lp.user_id = m.livreur_id
    WHERE m.commercant_id = ? ORDER BY m.created_at DESC LIMIT 100`).all(req.user.id));
});

// GET /api/commercant/historique?status=livree,refused,annulee
// → toutes les missions du commerçant (filtre de statut optionnel, liste séparée par des virgules)
const KNOWN_STATUSES = ['pending', 'accepted', 'refused', 'en_cours', 'livree', 'annulee'];
router.get('/historique', (req, res) => {
  try {
    const statuses = String(req.query.status || '').split(',').map((s) => s.trim()).filter(Boolean);
    const bad = statuses.filter((s) => !KNOWN_STATUSES.includes(s));
    if (bad.length) return res.status(400).json({ error: `Statut inconnu : ${bad.join(', ')}` });
    const where = statuses.length ? `AND m.status IN (${statuses.map(() => '?').join(',')})` : '';
    const rows = db.prepare(`
      SELECT m.*, u.name AS livreur_name, r.rating AS my_rating
      FROM missions m
      LEFT JOIN users u ON u.id = m.livreur_id
      LEFT JOIN reviews r ON r.mission_id = m.id AND r.reviewer_id = m.commercant_id
      WHERE m.commercant_id = ? ${where}
      ORDER BY m.created_at DESC, m.id DESC LIMIT 500`).all(req.user.id, ...statuses);
    const total = rows.filter((m) => m.status === 'livree').reduce((a, m) => a + (m.delivery_price || 0), 0);
    res.json({ missions: rows, stats: { count: rows.length, delivered_total: total } });
  } catch (e) { console.error('[historique]', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/commercant/missions/:id/cancel
router.put('/missions/:id/cancel', (req, res) => {
  const m = db.prepare('SELECT * FROM missions WHERE id = ? AND commercant_id = ?').get(req.params.id, req.user.id);
  if (!m) return res.status(404).json({ error: 'Mission introuvable' });
  if (!['pending', 'accepted'].includes(m.status)) return res.status(409).json({ error: 'Mission non annulable' });
  db.prepare(`UPDATE missions SET status = 'annulee' WHERE id = ?`).run(m.id);
  const io = req.app.get('io');
  io?.to(`user:${m.livreur_id}`).emit('mission:status-update', { missionId: m.id, status: 'annulee' });
  emitMissionStatus(io, m.id); // commerçant (autres onglets) + client lié
  res.json({ ok: true });
});

module.exports = router;
