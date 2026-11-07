# 🛵 Conciergerie de quartier — SaaS (V3)

Plateforme de coordination de livreurs de quartier : carte temps réel, messagerie privée, espace commerçant (livreur le plus proche), auto-inscription et **abonnement journalier de 200 FCFA**.

**Stack** : React 18 + Vite + React-Leaflet + Socket.io-client + TailwindCSS · Node.js + Express + Socket.io + JWT + bcrypt · SQLite (schéma compatible PostgreSQL) · OpenStreetMap (aucune clé API).

## Démarrage (Windows · PowerShell 5.1)

Prérequis : **Node.js ≥ 22** (prévu pour Node 24). Aucune compilation native : `better-sqlite3` ^12.9.0 fournit un binaire précompilé Windows x64 pour Node 24 ; `bcryptjs` est du JavaScript pur.

Configuration (optionnelle) :

```powershell
cd C:\Users\jacqu\conciergerie-saas
Copy-Item .env.example .env
```

Terminal 1 — API (http://localhost:4000) :

```powershell
cd C:\Users\jacqu\conciergerie-saas\server
npm install
node seed.js
npm run dev
```

Terminal 2 — Frontend (http://localhost:5173) :

```powershell
cd C:\Users\jacqu\conciergerie-saas\client
npm install
npm run dev
```

Si une installation précédente existe (better-sqlite3 11.x), supprimez d'abord `server\node_modules` et `server\package-lock.json` :

```powershell
cd C:\Users\jacqu\conciergerie-saas\server
Remove-Item -Recurse -Force node_modules, package-lock.json -ErrorAction SilentlyContinue
```

## Comptes de test

| Rôle | Email | Mot de passe | Abonnement |
|---|---|---|---|
| Admin | admin@test.com | admin123 | exempté |
| Commerçant | commercant@test.com | commercant123 | actif 7 jours |
| Client | client@test.com | client123 | actif 7 jours |
| Livreur | livreur1@test.com | livreur123 | approuvé + actif 7 jours |
| Livreur | livreur2@test.com | livreur123 | approuvé + actif 7 jours |

Pour tester sur plusieurs rôles en même temps : une fenêtre normale + une fenêtre privée (le jeton est stocké par navigateur). Sur téléphone (même Wi-Fi), ouvrez `http://<IP-du-PC>:5173` et mettez `VITE_API_URL=http://<IP-du-PC>:4000` et `CLIENT_ORIGIN=http://<IP-du-PC>:5173` dans `.env`. ⚠️ La géolocalisation du navigateur exige HTTPS hors `localhost`.

## Parcours

- **Inscription** (`/register`) : client, commerçant ou livreur. Admin jamais créé publiquement.
  - Client / commerçant → compte actif, redirection vers `/abonnement`.
  - Livreur → `livreur_profiles.status = pending_approval` + `recruitment_requests` ; l'approbation admin est **toujours** requise avant de se mettre en ligne.
- **Abonnement** (`/abonnement`) : statut, compte à rebours HH:MM:SS, bouton « Payer 200 FCFA » (+24h, cumulable).
- **Admin** (`/admin`, `/admin/subscriptions`) : recrutement, création de livreur, utilisateurs, carte globale, revenus, activation manuelle.
- **Client** (`/carte`) : livreurs en ligne et abonnés ; clic → position GPS envoyée au livreur + chat.
- **Livreur** (`/livreur`) : en ligne / hors ligne, démarrer la livraison (GPS toutes les 5 s), missions Accepter / Refuser, chat.
- **Commerçant** (`/commercant`) : livreurs triés par distance (Haversine), mission (clic carte pour l'adresse), suivi temps réel, chat par mission.

## API (résumé)

| Méthode | Route | Accès |
|---|---|---|
| POST | /api/auth/register · /api/auth/login | public |
| POST | /api/subscription/pay · /confirm — GET /status | connecté |
| GET/POST | /api/admin/recruitment, /:id/approve, /:id/reject, /livreurs, /users, /users/:id/grant, /subscriptions, /subscriptions/:id/activate, /livreurs/online | admin |
| GET/PUT | /api/livreur/me, /status, /missions, /missions/:id | livreur approuvé + abonné |
| GET | /api/client/livreurs | abonné |
| GET/POST/PUT | /api/commercant/livreurs?lat&lng, /missions, /missions/:id/cancel | commerçant abonné |
| GET | /api/messages/conversations, /api/messages/:userId | abonné |

Codes : 400 (validation), 401 (non authentifié), **402 (abonnement requis → le front redirige vers /abonnement)**, 403 (rôle / livreur en attente), 404, 409 (email pris, transition impossible), 500.

## Socket.io

Connexion : `io(API_URL, { auth: { token } })`. Rooms : `user:<id>` (privée) et `realtime` (abonnés actifs).

`livreur:location` · `livreur:position-update` · `client:click-livreur` · `client:position-shared` · `message:send` · `message:receive` · `mission:new` · `mission:accept` · `mission:refuse` · `mission:status-update` · `subscription:expired` (+ `livreur:offline`, `livreur:approved`, `subscription:refresh`).

Le cron (`server/services/subscriptionCron.js`, toutes les 60 s) passe les abonnements échus en `expired`, émet `subscription:expired`, retire l'utilisateur de la room `realtime` et met les livreurs concernés hors ligne.

## 💳 Paiement : MVP simulé → Mobile Money

Toute la logique est isolée dans **`server/services/payment.js`** avec une interface fixe :

```js
initPayment(userId, amount) // → { paymentId, amount, currency, transactionRef, paymentUrl? }
confirmPayment(paymentId)  // → { expires_at }   (expires_at = max(now, expiration actuelle) + 24h)
```

Aujourd'hui, le fournisseur `simulated` valide immédiatement. Pour brancher **CinetPay** (ou FedaPay) :

1. Renseigner dans `.env` : `PAYMENT_PROVIDER=cinetpay`, `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_NOTIFY_URL`.
2. Dans `payment.js`, implémenter l'adaptateur `providers.cinetpay` :
   - `init(sub, user)` → appel de l'API de checkout avec `transaction_id = sub.transaction_ref`, `amount = 200`, `currency = 'XOF'` ; retourner `{ paymentUrl }`.
   - `verify(sub)` → appel de l'API de vérification ; retourner `true` si le statut est accepté.
3. Côté front, si `paymentUrl` est présent, rediriger l'utilisateur vers cette URL au lieu d'appeler `/confirm` directement ; appeler `/confirm` (ou une route webhook qui appelle `confirmPayment`) au retour.

Les routes, le middleware 402, le cron et le front ne changent pas. En attendant, l'admin peut valider un paiement Mobile Money reçu manuellement via **Activer** dans `/admin/subscriptions` ou **+24h** dans la liste des utilisateurs.

## Migration PostgreSQL

`schema.sql` n'utilise que des types standards. Remplacer `INTEGER PRIMARY KEY AUTOINCREMENT` par `SERIAL PRIMARY KEY`, retirer le `PRAGMA`, et adapter `server/db.js` (driver `pg`, requêtes paramétrées `$1`).

## Notes

- `bcryptjs` : implémentation JS pure de bcrypt (même format de hash), aucune compilation.
- Statuts livreur : `pending_approval` → `approved` (validé, hors ligne) → `en_ligne` / `en_livraison` / `hors_ligne`.
- Le seed réinitialise toutes les tables.

## Mise en production

Voir [DEPLOIEMENT.md](DEPLOIEMENT.md) : backend sur Render (disque persistant pour SQLite), frontend sur Vercel, variables d environnement et FedaPay.
