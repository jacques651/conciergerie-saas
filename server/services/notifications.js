// Création + diffusion temps réel des notifications (tous les rôles).
// - Personnelle  : io → room user:<id>, évènement "notification:nouvelle"
// - Admin globale (userId null) : room "admins", évènement "notification:nouvelle"
const { db } = require('../db');

let ioRef = null;
/** Enregistre l'instance Socket.io (appelé au démarrage) pour pouvoir notifier depuis n'importe où */
function setIo(io) { ioRef = io; }

function emit(io, notif) {
  const target = io || ioRef;
  if (!target) return;
  const room = notif.user_id == null ? 'admins' : `user:${notif.user_id}`;
  const n = target.sockets.adapter.rooms.get(room)?.size || 0; // connexions actives dans la room
  console.log(`[notification] emit "${notif.type}" → room ${room} (${n} connexion(s)) : ${notif.message}`);
  target.to(room).emit('notification:nouvelle', notif);
}

/**
 * creerNotification(userId, type, message, link) → notification insérée et émise.
 * Messages : une seule notification non lue par conversation (mise à jour au lieu d'empiler).
 */
function creerNotification(userId, type, message, link = null, io = null) {
  try {
    if (type === 'message' && userId != null && link) {
      const prev = db.prepare("SELECT id FROM notifications WHERE user_id = ? AND type = 'message' AND link = ? AND is_read = 0").get(userId, link);
      if (prev) {
        db.prepare("UPDATE notifications SET message = ?, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(message, prev.id);
        const notif = { ...db.prepare('SELECT * FROM notifications WHERE id = ?').get(prev.id), updated: true };
        emit(io, notif);
        return notif;
      }
    }
    const { lastInsertRowid } = db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)')
      .run(userId, type, message, link);
    const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(lastInsertRowid);
    emit(io, notif);
    return notif;
  } catch (e) { console.error('[notification]', e.message); return null; }
}

/** Ancienne signature (objet) conservée pour les appels existants */
const notify = (io, { userId = null, type, message, link = null }) => creerNotification(userId, type, message, link, io);

/** Lien vers la conversation selon l'espace du destinataire */
const CHAT_PAGE = { livreur: '/livreur', commercant: '/commercant', client: '/carte', admin: '/admin' };
function chatLink(role, fromId, fromName) {
  return `${CHAT_PAGE[role] || '/'}?chat=${fromId}&nom=${encodeURIComponent(fromName || '')}`;
}

module.exports = { creerNotification, notify, setIo, chatLink };
