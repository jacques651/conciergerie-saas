// Validation des comptes par l'administrateur (tous rôles sauf admin).
// users.status : 'pending' (inscription) → 'approved' | 'rejected'
// Pour un livreur, livreur_profiles et recruitment_requests sont tenus synchronisés.
const { db, nowIso } = require('../db');

const ACCOUNT_STATUSES = ['pending', 'approved', 'rejected'];

/** Change le statut d'un compte. Retourne l'utilisateur mis à jour (ou null s'il n'existe pas). */
function setAccountStatus(userId, status, io) {
  if (!ACCOUNT_STATUSES.includes(status)) throw Object.assign(new Error('Statut invalide'), { status: 400 });
  const user = db.prepare('SELECT id, email, name, role, status FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  if (user.role === 'admin') throw Object.assign(new Error("Le statut d'un administrateur ne peut pas être modifié"), { status: 400 });

  db.transaction(() => {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, user.id);
    if (user.role === 'livreur') {
      // Profil livreur : 'approved' (validé, hors ligne) ou 'pending_approval' (bloqué)
      const exists = db.prepare('SELECT 1 FROM livreur_profiles WHERE user_id = ?').get(user.id);
      const lpStatus = status === 'approved' ? 'approved' : 'pending_approval';
      if (exists) {
        // On ne réinitialise pas un livreur déjà en ligne / en livraison s'il est re-approuvé
        if (status !== 'approved') db.prepare('UPDATE livreur_profiles SET status = ?, last_update = ? WHERE user_id = ?').run(lpStatus, nowIso(), user.id);
        else db.prepare(`UPDATE livreur_profiles SET status = 'approved', last_update = ? WHERE user_id = ? AND status = 'pending_approval'`).run(nowIso(), user.id);
      } else {
        db.prepare('INSERT INTO livreur_profiles (user_id, status) VALUES (?, ?)').run(user.id, lpStatus);
      }
      // Demande de recrutement (créée si absente)
      const req = db.prepare('SELECT id FROM recruitment_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(user.id);
      if (req) db.prepare('UPDATE recruitment_requests SET status = ? WHERE id = ?').run(status, req.id);
      else db.prepare('INSERT INTO recruitment_requests (email, name, status, user_id) VALUES (?, ?, ?, ?)').run(user.email, user.name, status, user.id);
    }
  })();

  if (io) {
    if (status === 'approved' && user.role === 'livreur') io.to(`user:${user.id}`).emit('livreur:approved', { userId: user.id });
    // Compte refusé / remis en attente : on coupe ses connexions temps réel
    if (status !== 'approved') io.in(`user:${user.id}`).disconnectSockets(true);
  }
  return { ...user, status };
}

module.exports = { setAccountStatus, ACCOUNT_STATUSES };
