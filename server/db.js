// Connexion SQLite (better-sqlite3, synchrone) + application du schéma au démarrage.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// DB_PATH absolu en production (ex. /var/data/data.sqlite sur le disque persistant Render)
const dbPath = path.resolve(__dirname, process.env.DB_PATH || './data.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Applique schema.sql (idempotent grâce aux IF NOT EXISTS)
const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
db.exec(schema);

// Migration : ajoute la colonne "plan" aux bases créées avant cette version
const subCols = db.prepare(`PRAGMA table_info(subscriptions)`).all().map((c) => c.name);
if (!subCols.includes('plan')) db.exec(`ALTER TABLE subscriptions ADD COLUMN plan TEXT NOT NULL DEFAULT 'daily'`);

// Migration : colonne "read_at" (messages non lus persistants)
const msgCols = db.prepare(`PRAGMA table_info(messages)`).all().map((c) => c.name);
if (!msgCols.includes('read_at')) {
  db.exec(`ALTER TABLE messages ADD COLUMN read_at TEXT`);
  // Les messages existants sont considérés comme lus (évite un afflux de "non lus" historiques)
  db.prepare(`UPDATE messages SET read_at = ? WHERE read_at IS NULL`).run(new Date().toISOString());
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_msg_unread ON messages(receiver_id, read_at)`);

// Migration : missions enrichies (prix de la course + détails de commande)
const missionCols = db.prepare(`PRAGMA table_info(missions)`).all().map((c) => c.name);
if (!missionCols.includes('delivery_price')) db.exec(`ALTER TABLE missions ADD COLUMN delivery_price INTEGER NOT NULL DEFAULT 0`);
if (!missionCols.includes('order_details')) db.exec(`ALTER TABLE missions ADD COLUMN order_details TEXT`);
// Migration : liaison des missions aux comptes clients + téléphone des utilisateurs
if (!missionCols.includes('client_id')) db.exec(`ALTER TABLE missions ADD COLUMN client_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
// Notifications (user_id NULL = notification globale des administrateurs)
db.exec(`CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_mission_client ON missions(client_id, status)`);
const userCols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
if (!userCols.includes('phone')) db.exec(`ALTER TABLE users ADD COLUMN phone TEXT`);
// Migration : validation des comptes par l'admin. Les comptes EXISTANTS sont considérés comme approuvés
// (sauf les livreurs encore en attente) pour ne bloquer personne lors de la mise à jour.
if (!userCols.includes('status')) {
  db.exec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'`);
  db.exec(`UPDATE users SET status = 'pending' WHERE role = 'livreur'
           AND id IN (SELECT user_id FROM livreur_profiles WHERE status = 'pending_approval')`);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_status ON users(status, role)`);

// Migration : connexion par téléphone (Burkina Faso)
//   - email devient FACULTATIF (NOT NULL retiré) → reconstruction de la table (SQLite ne sait pas modifier une colonne)
//   - phone devient UNIQUE et normalisé (8 chiffres). Numéros invalides ou en double → vidés (l'email reste l'identifiant).
(function migrateUsersPhoneLogin() {
  const cols = db.prepare(`PRAGMA table_info(users)`).all();
  const emailCol = cols.find((c) => c.name === 'email');
  const phoneUnique = db.prepare(`PRAGMA index_list(users)`).all()
    .some((ix) => ix.unique && db.prepare(`PRAGMA index_info("${ix.name}")`).all().some((c) => c.name === 'phone'));
  if (emailCol && !emailCol.notnull && phoneUnique) return; // déjà migré
  const { normalizePhone } = require('./services/phone');

  // Normalisation des téléphones existants (doublons → seul le plus ancien garde le numéro)
  const seen = new Set();
  const updates = db.prepare('SELECT id, phone FROM users ORDER BY id').all().map((u) => {
    const n = normalizePhone(u.phone);
    const keep = n && !seen.has(n) ? n : null;
    if (keep) seen.add(keep);
    return [keep, u.id];
  });

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE users_new (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          email         TEXT UNIQUE,
          password_hash TEXT NOT NULL,
          role          TEXT NOT NULL CHECK (role IN ('admin','livreur','client','commercant')),
          name          TEXT NOT NULL,
          phone         TEXT UNIQUE,
          status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
          created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users_new (id, email, password_hash, role, name, phone, status, created_at)
          SELECT id, NULLIF(TRIM(email), ''), password_hash, role, name, NULL, COALESCE(status, 'approved'), created_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
        CREATE INDEX IF NOT EXISTS idx_users_status ON users(status, role);
      `);
      const upd = db.prepare('UPDATE users SET phone = ? WHERE id = ?');
      for (const [phone, id] of updates) if (phone) upd.run(phone, id);
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length) throw new Error(`Migration users : ${broken.length} référence(s) cassée(s)`);
    })();
    console.log('[db] Migration : connexion par téléphone activée (email facultatif)');
  } finally {
    db.pragma('foreign_keys = ON');
  }
})();

// ---------------- Paramètres (table settings) ----------------
const DEFAULT_SETTINGS = { price_daily: '200', price_monthly: '5000', price_yearly: '50000' };
const PRICE_KEYS = ['price_daily', 'price_monthly', 'price_yearly'];

/** Crée les clés par défaut si elles n'existent pas (n'écrase jamais une valeur existante) */
function initDefaultSettings() {
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  db.transaction(() => { for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v); })();
}
initDefaultSettings();

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULT_SETTINGS[key] ?? null;
}

function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, String(value), new Date().toISOString());
}

/** Tarifs actuels en nombres : { price_daily, price_monthly, price_yearly } */
function getPrices() {
  return Object.fromEntries(PRICE_KEYS.map((k) => [k, Number(getSetting(k))]));
}

/** Date ISO courante (format stocké partout) */
const nowIso = () => new Date().toISOString();

/** Abonnement actif le plus lointain d'un utilisateur, ou null */
function getActiveSubscription(userId) {
  return db
    .prepare(
      `SELECT * FROM subscriptions
       WHERE user_id = ? AND status = 'active' AND expires_at > ?
       ORDER BY expires_at DESC LIMIT 1`
    )
    .get(userId, nowIso()) || null;
}

/** Date d'expiration la plus lointaine (même expirée) */
function getLatestExpiry(userId) {
  const row = db
    .prepare(`SELECT MAX(expires_at) AS e FROM subscriptions WHERE user_id = ? AND status = 'active'`)
    .get(userId);
  return row && row.e ? row.e : null;
}

module.exports = {
  db, nowIso, getActiveSubscription, getLatestExpiry,
  initDefaultSettings, getSetting, setSetting, getPrices, PRICE_KEYS
};
