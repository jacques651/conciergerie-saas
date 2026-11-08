// Notifications de l'utilisateur connecté (+ notifications globales pour les admins).
const router = require('express').Router();
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);
const scope = (u) => (u.role === 'admin' ? '(user_id = @me OR user_id IS NULL)' : 'user_id = @me');

// GET /api/notifications → { notifications (50 plus récentes), unread }
router.get('/', (req, res) => {
  const w = scope(req.user), me = req.user.id;
  res.json({
    notifications: db.prepare(`SELECT * FROM notifications WHERE ${w} ORDER BY id DESC LIMIT 50`).all({ me }),
    unread: db.prepare(`SELECT COUNT(*) n FROM notifications WHERE ${w} AND is_read = 0`).get({ me }).n
  });
});

// GET /api/notifications/socket-status → connexions Socket.io actives dans la room privée (diagnostic)
router.get('/socket-status', async (req, res) => {
  const io = req.app.get('io');
  const sockets = io ? await io.in(`user:${req.user.id}`).fetchSockets() : [];
  res.json({ userId: req.user.id, room: `user:${req.user.id}`, connexions: sockets.length, ids: sockets.map((s) => s.id) });
});

// POST /api/notifications/read-all
router.post('/read-all', (req, res) => {
  db.prepare(`UPDATE notifications SET is_read = 1 WHERE ${scope(req.user)} AND is_read = 0`).run({ me: req.user.id });
  res.json({ ok: true });
});

// POST /api/notifications/:id/read
router.post('/:id/read', (req, res) => {
  const r = db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = @id AND ${scope(req.user)}`).run({ id: Number(req.params.id), me: req.user.id });
  if (!r.changes) return res.status(404).json({ error: 'Notification introuvable' });
  res.json({ ok: true });
});

module.exports = router;
