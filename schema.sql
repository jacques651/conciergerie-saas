-- =============================================================
-- Conciergerie SaaS — Schéma de base de données (SQLite)
-- Structure volontairement compatible PostgreSQL :
--   * types TEXT / INTEGER / REAL standards
--   * dates stockées en TEXT ISO-8601 (TIMESTAMPTZ côté PG)
--   * pas de fonctions propriétaires SQLite dans les contraintes
-- Migration PG : remplacer "INTEGER PRIMARY KEY AUTOINCREMENT" par "SERIAL PRIMARY KEY".
-- =============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','livreur','client','commercant')),
  name          TEXT NOT NULL,
  phone         TEXT,            -- téléphone (facultatif, utilisé pour les missions liées)
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), -- validation admin
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Statuts livreur : pending_approval | approved | hors_ligne | en_ligne | en_livraison
-- (approved = validé mais jamais mis en ligne ; tout statut != pending_approval est "approuvé")
CREATE TABLE IF NOT EXISTS livreur_profiles (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending_approval',
  lat         REAL,
  lng         REAL,
  last_update TEXT
);

CREATE TABLE IF NOT EXISTS recruitment_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at     TEXT              -- NULL = non lu par le destinataire
);

-- Statuts mission : pending | accepted | refused | en_cours | livree | annulee
CREATE TABLE IF NOT EXISTS missions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  commercant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  livreur_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  client_id     INTEGER REFERENCES users(id) ON DELETE SET NULL, -- compte client destinataire (facultatif)
  client_name   TEXT NOT NULL,
  client_phone  TEXT NOT NULL,
  client_lat    REAL,
  client_lng    REAL,
  description   TEXT,
  order_details  TEXT,              -- détails de la commande (articles, quantités…)
  delivery_price INTEGER NOT NULL DEFAULT 0, -- prix de la course (FCFA)
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at   TEXT,
  completed_at  TEXT
);

-- Paramètres globaux modifiables par l'admin (tarifs, etc.)
CREATE TABLE IF NOT EXISTS settings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Statuts abonnement : pending | active | expired | failed
-- Formules (plan) : daily | monthly | yearly
CREATE TABLE IF NOT EXISTS subscriptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount          INTEGER NOT NULL DEFAULT 200,
  currency        TEXT NOT NULL DEFAULT 'XOF',
  starts_at       TEXT,
  expires_at      TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  plan            TEXT NOT NULL DEFAULT 'daily',
  payment_method  TEXT,
  transaction_ref TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Notes laissées après une mission livrée (une seule note par mission et par auteur)
CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id  INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (mission_id, reviewer_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews(reviewee_id, created_at);

CREATE INDEX IF NOT EXISTS idx_sub_user     ON subscriptions(user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_msg_pair     ON messages(sender_id, receiver_id);
-- idx_msg_unread est créé dans db.js (après la migration de la colonne read_at)
CREATE INDEX IF NOT EXISTS idx_mission_liv  ON missions(livreur_id, status);
CREATE INDEX IF NOT EXISTS idx_mission_com  ON missions(commercant_id, status);
