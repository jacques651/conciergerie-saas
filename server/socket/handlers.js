// Gestion temps réel (Socket.io).
// Rooms : "user:<id>" (privée) et "realtime" (carte, réservée aux abonnés actifs).
const { db, nowIso } = require('../db');
const { verifyToken, isSubscribed } = require('../middleware/auth');
const { emitMissionStatus } = require('../services/missionEvents');

function initSocket(io) {
  // Authentification par JWT au handshake : io(url, { auth: { token } })
  io.use((socket, next) => {
    try {
      const p = verifyToken(socket.handshake.auth?.token);
      const user = db.prepare('SELECT id, name, role, email, phone, status FROM users WHERE id = ?').get(p.id);
      if (!user) return next(new Error('unauthorized'));
      if (user.role !== 'admin' && user.status !== 'approved') return next(new Error('account_not_approved'));
      socket.user = user;
      next();
    } catch { next(new Error('unauthorized')); }
  });

  io.on('connection', (socket) => {
    const u = socket.user;
    socket.join(`user:${u.id}`); // room privée toujours accessible (pour recevoir "subscription:expired")
    if (isSubscribed(u)) socket.join('realtime');
    if (u.role === 'admin') socket.join('admins');

    // Garde : action temps réel autorisée seulement si abonnement actif
    const guard = (fn) => (...args) => {
      if (!isSubscribed(u)) {
        socket.emit('subscription:expired', { userId: u.id });
        socket.leave('realtime');
        return;
      }
      try { fn(...args); } catch (e) { console.error('[socket]', e); socket.emit('error:message', { error: 'Erreur serveur' }); }
    };

    // --- Livreur : position GPS -------------------------------
    socket.on('livreur:location', guard(({ lat, lng } = {}) => {
      if (u.role !== 'livreur' || typeof lat !== 'number' || typeof lng !== 'number') return;
      const p = db.prepare('SELECT status FROM livreur_profiles WHERE user_id = ?').get(u.id);
      if (!p || p.status === 'pending_approval') return;
      db.prepare('UPDATE livreur_profiles SET lat = ?, lng = ?, last_update = ? WHERE user_id = ?').run(lat, lng, nowIso(), u.id);
      if (p.status === 'en_ligne' || p.status === 'en_livraison') {
        io.to('realtime').emit('livreur:position-update', { livreurId: u.id, name: u.name, lat, lng, status: p.status });
      }
    }));

    // --- Client : clic sur un livreur → partage de sa position --
    socket.on('client:click-livreur', guard(({ livreurId, clientLat, clientLng } = {}) => {
      if (!livreurId) return;
      io.to(`user:${livreurId}`).emit('client:position-shared', {
        clientId: u.id, clientName: u.name, clientLat, clientLng
      });
    }));

    // --- Messagerie privée ------------------------------------
    socket.on('message:send', guard(({ to, content } = {}, ack) => {
      const text = String(content || '').trim().slice(0, 2000);
      if (!to || !text) return ack?.({ error: 'Message vide' });
      if (Number(to) === u.id) return ack?.({ error: 'Impossible de s\'écrire à soi-même' });
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(to)) return ack?.({ error: 'Destinataire introuvable' });
      const ts = nowIso();
      const { lastInsertRowid } = db.prepare('INSERT INTO messages (sender_id, receiver_id, content, created_at) VALUES (?, ?, ?, ?)')
        .run(u.id, to, text, ts);
      const dest = db.prepare('SELECT name, role FROM users WHERE id = ?').get(to);
      const msg = {
        id: lastInsertRowid, from: u.id, fromName: u.name, fromRole: u.role,
        to: Number(to), toName: dest.name, toRole: dest.role, content: text, timestamp: ts, read_at: null
      };
      // Message persisté → diffusé au destinataire ET à l'expéditeur (tous ses onglets/appareils,
      // y compris celui-ci) pour un affichage instantané. Le front déduplique par id.
      io.to(`user:${to}`).to(`user:${u.id}`).emit('message:receive', msg);
      ack?.({ ok: true, message: msg });
    }));

    // --- Missions (alternative socket aux routes REST) ---------
    // Accepter / refuser une mission → mise à jour en base + notification du commerçant
    const missionAction = (status, col) => guard(({ missionId } = {}, ack) => {
      const m = db.prepare('SELECT * FROM missions WHERE id = ? AND livreur_id = ?').get(missionId, u.id);
      if (!m) return ack?.({ error: 'Mission introuvable' });
      if (m.status !== 'pending') return ack?.({ error: `Mission déjà "${m.status}"` });
      db.prepare(`UPDATE missions SET status = ?${col ? `, ${col} = ?` : ''} WHERE id = ?`)
        .run(...(col ? [status, nowIso(), m.id] : [status, m.id]));
      const mission = emitMissionStatus(io, m.id, { livreurName: u.name }); // commerçant + client lié
      ack?.({ ok: true, mission });
    });
    socket.on('mission:accept', missionAction('accepted', 'accepted_at'));
    socket.on('mission:refuse', missionAction('refused'));

    // Livraison terminée par le livreur → statut "livree" + date de fin, livreur de nouveau disponible,
    // commerçant notifié en temps réel. Réponse via ack : { ok, mission } ou { error }.
    socket.on('mission:completed', guard(({ missionId } = {}, ack) => {
      if (u.role !== 'livreur') return ack?.({ error: 'Réservé aux livreurs' });
      const m = db.prepare('SELECT * FROM missions WHERE id = ? AND livreur_id = ?').get(missionId, u.id);
      if (!m) return ack?.({ error: 'Mission introuvable' });
      if (!['accepted', 'en_cours'].includes(m.status)) return ack?.({ error: `Mission déjà "${m.status}"` });
      const now = nowIso();
      db.transaction(() => {
        db.prepare(`UPDATE missions SET status = 'livree', completed_at = ? WHERE id = ?`).run(now, m.id);
        db.prepare(`UPDATE livreur_profiles SET status = 'en_ligne', last_update = ? WHERE user_id = ?`).run(now, u.id);
      })();
      // Commerçant : "mission:status-update" + "mission:completed" ; client lié : idem + "mission:completed-client"
      const mission = emitMissionStatus(io, m.id, { livreurName: u.name });
      ack?.({ ok: true, mission });
    }));

    socket.on('mission:status-update', guard(({ missionId, status } = {}) => {
      const allowed = { en_cours: 'accepted', livree: 'en_cours' };
      const m = db.prepare('SELECT * FROM missions WHERE id = ? AND livreur_id = ?').get(missionId, u.id);
      if (!m || allowed[status] !== m.status) return;
      db.prepare(`UPDATE missions SET status = ?${status === 'livree' ? ', completed_at = ?' : ''} WHERE id = ?`)
        .run(...(status === 'livree' ? [status, nowIso(), m.id] : [status, m.id]));
      emitMissionStatus(io, m.id, { livreurName: u.name });
    }));

    // Réabonnement : le client demande à rejoindre de nouveau le temps réel
    socket.on('subscription:refresh', () => { if (isSubscribed(u)) socket.join('realtime'); });

    socket.on('disconnect', () => { /* la position reste ; le statut est géré explicitement */ });
  });
}

module.exports = { initSocket };
