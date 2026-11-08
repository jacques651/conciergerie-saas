// Création + diffusion temps réel des notifications.
// userId null → notification globale admin (room "admins", évènement "notification:admin").
const { db } = require('../db');

function notify(io, { userId = null, type, message, link = null }) {
  try {
    const { lastInsertRowid } = db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)')
      .run(userId, type, message, link);
    const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(lastInsertRowid);
    if (io) {
      if (userId == null) io.to('admins').emit('notification:admin', notif);
      else io.to(`user:${userId}`).emit('notification:new', notif);
    }
    return notif;
  } catch (e) { console.error('[notify]', e.message); return null; }
}

module.exports = { notify };
