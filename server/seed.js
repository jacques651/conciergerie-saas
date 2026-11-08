// Données de test. Usage : node seed.js  (réinitialise toutes les tables)
// Garde-fou : ce script EFFACE toutes les données.
// (RENDER est défini automatiquement par Render ; ALLOW_SEED=false pour bloquer ailleurs)
if ((process.env.RENDER || process.env.ALLOW_SEED === 'false') && !process.argv.includes('--force')) {
  console.error('❌ seed.js efface toutes les données : refusé sur le serveur de production (ajoutez --force si vous êtes certain).');
  process.exit(1);
}
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const DAY = 86400000;
const in7d = () => new Date(Date.now() + 7 * DAY).toISOString();

db.exec(`DELETE FROM reviews; DELETE FROM messages; DELETE FROM missions; DELETE FROM subscriptions;
         DELETE FROM recruitment_requests; DELETE FROM livreur_profiles; DELETE FROM users;
         DELETE FROM sqlite_sequence;`);

// Comptes de test : connexion par téléphone (ou par email, conservé pour compatibilité)
const addUser = (email, pwd, role, name, phone) =>
  db.prepare(`INSERT INTO users (email, password_hash, role, name, status, phone) VALUES (?, ?, ?, ?, 'approved', ?)`)
    .run(email, bcrypt.hashSync(pwd, 10), role, name, phone).lastInsertRowid;

const addSub = (userId) =>
  db.prepare(`INSERT INTO subscriptions (user_id, amount, currency, starts_at, expires_at, status, payment_method, transaction_ref)
              VALUES (?, 1400, 'XOF', ?, ?, 'active', 'seed', ?)`)
    .run(userId, new Date().toISOString(), in7d(), `SEED-${userId}`);

db.transaction(() => {
  // Admin : non soumis à l'abonnement (aucune ligne nécessaire)
  addUser('admin@test.com', 'admin123', 'admin', 'Administrateur', '70000000');

  addSub(addUser('commercant@test.com', 'commercant123', 'commercant', 'Boutique Wend-Kuuni', '70000002'));
  const clientId = addUser('client@test.com', 'client123', 'client', 'Client Test', '70000001');
  addSub(clientId);

  // Livreurs approuvés, positionnés à Ouagadougou, hors ligne au départ
  const livreurs = [
    ['livreur1@test.com', 'Livreur Moussa', 12.3714, -1.5197, '70000003'],
    ['livreur2@test.com', 'Livreur Awa', 12.3569, -1.5353, '70000004']
  ];
  for (const [email, name, lat, lng, phone] of livreurs) {
    const id = addUser(email, 'livreur123', 'livreur', name, phone);
    db.prepare(`INSERT INTO livreur_profiles (user_id, status, lat, lng, last_update) VALUES (?, 'en_ligne', ?, ?, ?)`)
      .run(id, lat, lng, new Date().toISOString());
    db.prepare(`INSERT INTO recruitment_requests (email, name, status, user_id) VALUES (?, ?, 'approved', ?)`).run(email, name, id);
    addSub(id);
  }
})();

console.log('🌱 Seed terminé :');
console.table([
  { role: 'admin', telephone: '70000000', email: 'admin@test.com', mdp: 'admin123' },
  { role: 'commercant', telephone: '70000002', email: 'commercant@test.com', mdp: 'commercant123' },
  { role: 'client', telephone: '70000001', email: 'client@test.com', mdp: 'client123' },
  { role: 'livreur', telephone: '70000003', email: 'livreur1@test.com', mdp: 'livreur123' },
  { role: 'livreur', telephone: '70000004', email: 'livreur2@test.com', mdp: 'livreur123' }
]);
process.exit(0);
