// Messagerie privée : historique des conversations + statut lu / non lu persistant.
// L'envoi passe par Socket.io ("message:send") ; ces routes servent à relire et marquer comme lu.
const router = require('express').Router();
const { db, nowIso } = require('../db');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');

router.use(requireAuth, requireActiveSubscription);

/** Nombre total de messages non lus reçus par un utilisateur */
const totalUnread = (userId) =>
  db.prepare('SELECT COUNT(*) AS n FROM messages WHERE receiver_id = ? AND read_at IS NULL').get(userId).n;

// GET /api/messages/conversations
// → un élément par interlocuteur : { id, name, role, last_message, last_from, last_at, message_count, unread }
router.get('/conversations', (req, res) => {
  try {
    const me = req.user.id;
    // On ramène chaque message à son interlocuteur ("contact_id"), GROUP BY contact,
    // puis on rejoint le dernier message (id max) de chaque conversation.
    const rows = db.prepare(`
      WITH mine AS (
        SELECT id, sender_id, receiver_id, content, created_at, read_at,
               CASE WHEN sender_id = @me THEN receiver_id ELSE sender_id END AS contact_id
        FROM messages
        WHERE sender_id = @me OR receiver_id = @me
      ),
      grouped AS (
        SELECT contact_id,
               MAX(id)  AS last_id,
               COUNT(*) AS message_count,
               SUM(CASE WHEN receiver_id = @me AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
        FROM mine GROUP BY contact_id
      )
      SELECT u.id, u.name, u.role,
             m.content    AS last_message,
             m.sender_id  AS last_from,
             m.created_at AS last_at,
             m.read_at    AS last_read_at,
             g.message_count, g.unread
      FROM grouped g
      JOIN mine  m ON m.id = g.last_id
      JOIN users u ON u.id = g.contact_id
      ORDER BY m.id DESC`).all({ me });
    res.json(rows);
  } catch (e) {
    console.error('[messages/conversations]', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/messages/unread-count → { total } (badges)
router.get('/unread-count', (req, res) => {
  try { res.json({ total: totalUnread(req.user.id) }); }
  catch (e) { console.error('[messages/unread-count]', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/messages/:userId → historique complet avec cet utilisateur (ordre chronologique)
router.get('/:userId', (req, res) => {
  try {
    const me = req.user.id, other = Number(req.params.userId);
    if (!Number.isInteger(other) || other <= 0) return res.status(400).json({ error: 'userId invalide' });
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(other)) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json(db.prepare(`
      SELECT id, sender_id AS "from", receiver_id AS "to", content, created_at AS timestamp, read_at
      FROM messages
      WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
      ORDER BY created_at ASC, id ASC LIMIT 1000`).all(me, other, other, me));
  } catch (e) {
    console.error('[messages/:userId]', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/messages/:userId/read → marque comme lus tous les messages reçus de cet utilisateur
// Notifie l'expéditeur (accusés de lecture) et les autres onglets du lecteur (badges).
router.post('/:userId/read', (req, res) => {
  try {
    const me = req.user.id, other = Number(req.params.userId);
    if (!Number.isInteger(other) || other <= 0) return res.status(400).json({ error: 'userId invalide' });
    const readAt = nowIso();
    const { changes } = db.prepare(
      'UPDATE messages SET read_at = ? WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL'
    ).run(readAt, other, me);
    const total = totalUnread(me);
    if (changes > 0) {
      const io = req.app.get('io');
      io?.to(`user:${other}`).emit('message:read', { by: me, contactId: me, readAt });
      io?.to(`user:${me}`).emit('message:unread-count', { total, contactId: other });
    }
    res.json({ updated: changes, readAt, total });
  } catch (e) {
    console.error('[messages/read]', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
