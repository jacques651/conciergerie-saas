// Inscription publique et connexion.
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, getActiveSubscription } = require('../db');
const { signToken, accountStatusMessage } = require('../middleware/auth');

// Rôles ouverts à l'inscription publique. Tout nouveau compte est « pending » jusqu'à validation par l'admin.
const PUBLIC_ROLES = ['client', 'commercant', 'livreur'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function authPayload(user) {
  const sub = user.role === 'admin' ? null : getActiveSubscription(user.id);
  const profile = user.role === 'livreur'
    ? db.prepare('SELECT status FROM livreur_profiles WHERE user_id = ?').get(user.id)
    : null;
  return {
    token: signToken(user),
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    role: user.role,
    subscription: {
      active: user.role === 'admin' || !!sub,
      expires_at: user.role === 'admin' ? null : sub?.expires_at || null,
      exempt: user.role === 'admin'
    },
    livreurStatus: profile?.status || null
  };
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  try {
    const { email, password, name, role } = req.body || {};
    const phone = req.body?.phone ? String(req.body.phone).trim().slice(0, 30) : null;
    if (phone && !/^[+0-9 ().-]{6,30}$/.test(phone)) return res.status(400).json({ error: 'Numéro de téléphone invalide' });
    if (!email || !password || !name || !role)
      return res.status(400).json({ error: 'Champs requis : email, password, name, role' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Email invalide' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum' });
    if (role === 'admin') return res.status(403).json({ error: 'Ce rôle ne peut pas être créé par inscription publique.' });
    if (!PUBLIC_ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide : client, commercant ou livreur' });

    const mail = email.trim().toLowerCase();
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail))
      return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    const hash = bcrypt.hashSync(password, 10);
    // Transaction : utilisateur + profil livreur + demande de recrutement
    const create = db.transaction(() => {
      const { lastInsertRowid: id } = db
        .prepare(`INSERT INTO users (email, password_hash, role, name, phone, status) VALUES (?, ?, ?, ?, ?, 'pending')`)
        .run(mail, hash, role, name.trim(), phone);
      // Livreur : profil bloqué ("pending_approval") + demande de recrutement, synchronisés à la validation
      if (role === 'livreur') {
        db.prepare(`INSERT INTO livreur_profiles (user_id, status) VALUES (?, 'pending_approval')`).run(id);
        db.prepare(`INSERT INTO recruitment_requests (email, name, status, user_id) VALUES (?, ?, 'pending', ?)`)
          .run(mail, name.trim(), id);
      }
      return id;
    });
    const id = create();
    // Pas de connexion automatique : le compte doit d'abord être approuvé par l'administrateur
    req.app.get('io')?.to('admins').emit('account:new', { id, name: name.trim(), role });
    return res.status(201).json({
      ok: true,
      status: 'pending',
      user: { id, email: mail, name: name.trim(), role },
      message: 'Votre compte est en attente de validation par un administrateur.'
    });
  } catch (e) {
    console.error('[register]', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Identifiants incorrects' });
    // Validation par l'admin requise (l'admin lui-même n'est jamais bloqué)
    if (user.role !== 'admin' && user.status !== 'approved')
      return res.status(403).json({ error: accountStatusMessage(user.status), code: 'ACCOUNT_' + String(user.status).toUpperCase() });
    return res.json(authPayload(user));
  } catch (e) {
    console.error('[login]', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
module.exports.authPayload = authPayload;
