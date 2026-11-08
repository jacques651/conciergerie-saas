// Création du compte administrateur initial, sans passer par seed.js
// (seed.js EFFACE toutes les données : à ne jamais lancer en production).
// Si ADMIN_EMAIL et/ou ADMIN_PHONE, et ADMIN_PASSWORD sont définis et qu'aucun compte avec cet email n'existe,
// l'admin est créé au démarrage. Sans effet sinon (idempotent).
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { normalizePhone } = require('./phone');

module.exports = function bootstrapAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase() || null;
  const phone = normalizePhone(process.env.ADMIN_PHONE);
  const password = process.env.ADMIN_PASSWORD || '';
  if ((!email && !phone) || !password) return;
  try {
    if (email && db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return;
    if (phone && db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) return;
    if (password.length < 10) {
      console.warn('[admin] ADMIN_PASSWORD trop court (10 caractères minimum) : admin non créé.');
      return;
    }
    db.prepare(`INSERT INTO users (email, phone, password_hash, role, name, status) VALUES (?, ?, ?, 'admin', ?, 'approved')`)
      .run(email, phone, bcrypt.hashSync(password, 10), process.env.ADMIN_NAME || 'Administrateur');
    console.log(`[admin] Compte administrateur créé : ${email || phone} (vous pouvez retirer ADMIN_PASSWORD des variables)`);
  } catch (e) {
    console.error('[admin] création impossible', e.message);
  }
};
