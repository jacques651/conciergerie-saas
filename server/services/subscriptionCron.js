// Cron (setInterval 60 s) : détecte les abonnements expirés,
// notifie l'utilisateur ("subscription:expired"), le retire des rooms temps réel
// et passe les livreurs concernés hors ligne.
const { db, nowIso, getActiveSubscription } = require('../db');

function startSubscriptionCron(io, intervalMs = 60_000) {
  const tick = () => {
    try {
      const now = nowIso();
      // Abonnements "active" dont la date est dépassée
      const expired = db.prepare(`SELECT id, user_id FROM subscriptions WHERE status = 'active' AND expires_at <= ?`).all(now);
      if (!expired.length) return;
      db.prepare(`UPDATE subscriptions SET status = 'expired' WHERE status = 'active' AND expires_at <= ?`).run(now);

      const userIds = [...new Set(expired.map((s) => s.user_id))];
      for (const userId of userIds) {
        if (getActiveSubscription(userId)) continue; // un autre abonnement prend le relais
        const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
        if (!user || user.role === 'admin') continue;

        if (user.role === 'livreur') {
          db.prepare(`UPDATE livreur_profiles SET status = 'hors_ligne' WHERE user_id = ? AND status IN ('en_ligne','en_livraison')`).run(userId);
          io.to('realtime').emit('livreur:offline', { livreurId: userId });
        }
        io.to(`user:${userId}`).emit('subscription:expired', { userId });
        // Retire toutes ses sockets de la room temps réel (il garde sa room privée)
        io.in(`user:${userId}`).socketsLeave('realtime');
        console.log(`[cron] abonnement expiré → user ${userId}`);
      }
    } catch (e) {
      console.error('[cron] erreur', e);
    }
  };
  tick();
  return setInterval(tick, intervalMs);
}

module.exports = { startSubscriptionCron };
