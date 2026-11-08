// Inscription publique et connexion.
const { notify } = require('../services/notifications');
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, getActiveSubscription } = require('../db');
const { signToken, accountStatusMessage } = require('../middleware/auth');
const { normalizePhone, formatPhone, PHONE_FORMAT_MESSAGE } = require('../services/phone');

const MIN_PASSWORD = 4; // mots de passe courts acceptés (usage local)

// Rôles ouverts à l'inscription publique. Tout nouveau compte est « pending » jusqu'à validation par l'admin.
const PUBLIC_ROLES = ['client', 'commercant', 'livreur'];

function authPayload(user) {
  const sub = user.role === 'admin' ? null : getActiveSubscription(user.id);
  const profile = user.role === 'livreur'
    ? db.prepare('SELECT status FROM livreur_profiles WHERE user_id = ?').get(user.id)
    : null;
  return {
    token: signToken(user),
    user: { id: user.id, phone: user.phone, email: user.email, name: user.name, role: user.role },
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
    // Champs acceptés : name, phone, password, role (formulaire simplifié, pas d'email)
    const { password, role } = req.body || {};
    const name = String(req.body?.name || '').trim();
    if (!req.body?.phone) return res.status(400).json({ error: 'Le numéro de téléphone est obligatoire' });
    if (!password) return res.status(400).json({ error: 'Le mot de passe est obligatoire' });
    if (!name) return res.status(400).json({ error: 'Le nom complet est obligatoire' });
    if (!role) return res.status(400).json({ error: 'Choisissez un profil : client, commerçant ou livreur' });
    const phone = normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: PHONE_FORMAT_MESSAGE });
    if (String(password).length < MIN_PASSWORD) return res.status(400).json({ error: `Mot de passe : ${MIN_PASSWORD} caractères minimum` });
    if (role === 'admin') return res.status(403).json({ error: 'Ce rôle ne peut pas être créé par inscription publique.' });
    if (!PUBLIC_ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide : client, commercant ou livreur' });

    // Unicité : téléphone puis email
    if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone))
      return res.status(409).json({ error: `Le numéro ${formatPhone(phone)} est déjà utilisé par un autre compte` });
    const email = null; // l'email n'est plus demandé à l'inscription (colonne conservée, facultative)

    const hash = bcrypt.hashSync(password, 10);
    // Transaction : utilisateur + (livreur) profil bloqué et demande de recrutement
    const create = db.transaction(() => {
      const { lastInsertRowid: id } = db
        .prepare(`INSERT INTO users (email, password_hash, role, name, phone, status) VALUES (?, ?, ?, ?, ?, 'pending')`)
        .run(email, hash, role, name, phone);
      if (role === 'livreur') {
        db.prepare(`INSERT INTO livreur_profiles (user_id, status) VALUES (?, 'pending_approval')`).run(id);
        // recruitment_requests.email sert de contact affiché : email ou, à défaut, téléphone
        db.prepare(`INSERT INTO recruitment_requests (email, name, status, user_id) VALUES (?, ?, 'pending', ?)`)
          .run(email || formatPhone(phone), name, id);
      }
      return id;
    });
    const id = create();
    // Pas de connexion automatique : le compte doit d'abord être approuvé par l'administrateur
    req.app.get('io')?.to('admins').emit('account:new', { id, name, role });
    notify(req.app.get('io'), { userId: null, type: 'account_request', message: `Nouvelle demande d'inscription : ${name} (${role}) · ${formatPhone(phone)}`, link: '/admin?tab=demandes' });
    return res.status(201).json({
      ok: true,
      status: 'pending',
      user: { id, phone, email, name, role },
      message: 'Votre compte est en attente de validation par un administrateur.'
    });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ce numéro est déjà utilisé par un autre compte' });
    console.error('[register]', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/login { phone, password }
// 1) recherche par numéro de téléphone (70123456, 70 12 34 56, +226 70 12 34 56…)
// 2) sinon, recherche par email (anciens comptes créés avec un email)
// (Compatibilité : les champs « identifier » et « email » sont aussi acceptés.)
router.post('/login', (req, res) => {
  try {
    const login = String(req.body?.phone ?? req.body?.identifier ?? req.body?.email ?? '').trim();
    const { password } = req.body || {};
    if (!login || !password) return res.status(400).json({ error: 'Téléphone et mot de passe requis' });

    let user = null;
    const phone = normalizePhone(login);
    if (phone) user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    if (!user && login.includes('@')) user = db.prepare('SELECT * FROM users WHERE email = ?').get(login.toLowerCase());
    if (!user && !phone && !login.includes('@')) return res.status(400).json({ error: PHONE_FORMAT_MESSAGE });
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Téléphone ou mot de passe incorrect' });
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
