# Déploiement : Render (backend) + Vercel (frontend)

Architecture en ligne :

```
Navigateur / PWA  ──HTTPS──▶  Vercel (client/ : React + Vite, fichiers statiques)
        │
        └──HTTPS + WebSocket──▶  Render (server/ : Express + Socket.io)
                                        │
                                        └── SQLite sur disque persistant /var/data
FedaPay ──webhook HTTPS──▶ Render /api/webhooks/fedapay
```

---

## 0. Pré-requis

1. **Dépôt Git** (GitHub, GitLab ou Bitbucket) contenant tout le projet `conciergerie-saas/`.
   Le fichier `.gitignore` exclut déjà `node_modules`, `.env`, la base `*.sqlite` et `client/certs/`.
   ```powershell
   cd C:\Users\jacqu\conciergerie-saas
   git init
   git add .
   git commit -m "Conciergerie : version de production"
   git branch -M main
   git remote add origin https://github.com/<votre-compte>/conciergerie-saas.git
   git push -u origin main
   ```
   ⚠️ Vérifiez avec `git status` qu'**aucun** fichier `.env` ni `data.sqlite` n'est suivi.
2. Un compte **Render** (render.com) et un compte **Vercel** (vercel.com), connectés à ce dépôt.
3. Un secret JWT fort (32 caractères minimum). Render peut le générer pour vous (voir plus bas).

---

## 1. Base SQLite persistante (important)

Sur Render, le système de fichiers d'un service est **éphémère** : tout ce qui est écrit hors d'un disque
est **perdu à chaque déploiement ou redémarrage**. La base SQLite doit donc vivre sur un **disque persistant**.

- Les disques persistants Render ne sont disponibles **que sur les offres payantes** (Starter ou plus).
  L'offre gratuite ne convient pas : vous perdriez comptes, missions et abonnements.
- Le fichier `render.yaml` déclare déjà le disque :
  - nom `sqlite-data`, monté sur `/var/data`, 1 Go ;
  - `DB_PATH=/var/data/data.sqlite` (le dossier est créé automatiquement au démarrage).
- Le schéma est appliqué automatiquement au démarrage (`schema.sql` + migrations dans `server/db.js`).
- **Ne lancez jamais `node seed.js` en production** : il efface toutes les données. Il est bloqué sur Render
  (variable `RENDER` détectée). L'administrateur est créé autrement (étape 2.4).
- Sauvegardes : Render prend des instantanés quotidiens des disques ; vous pouvez aussi télécharger le
  fichier via le **Shell** du service (`/var/data/data.sqlite`).
- Contrainte : un disque est attaché à **une seule instance** (pas de mise à l'échelle horizontale). Pour aller
  plus loin, le schéma est compatible PostgreSQL (voir README).

---

## 2. Backend sur Render

### 2.1 Création par Blueprint (recommandé)
1. Render → **New** → **Blueprint** → choisissez le dépôt. Render lit `render.yaml` à la racine.
2. Render demande les variables marquées `sync: false` : remplissez-les (tableau ci-dessous).
3. Validez : Render installe les dépendances (`cd server && npm ci --omit=dev`) puis démarre (`npm start`).
4. Notez l'URL du service : `https://conciergerie-api.onrender.com` (le nom exact est affiché par Render).
5. Test : ouvrez `https://<votre-backend>.onrender.com/api/health` → `{"ok":true,...}`.

### 2.2 Création manuelle (alternative)
Render → **New** → **Web Service** → dépôt, puis :
| Champ | Valeur |
|---|---|
| Root Directory | *(vide : racine du dépôt, car `schema.sql` est à la racine)* |
| Runtime | Node |
| Build Command | `cd server && npm ci --omit=dev` |
| Start Command | `cd server && npm start` |
| Health Check Path | `/api/health` |
| Instance | Starter (ou plus) |
| Disk | Mount Path `/var/data`, 1 Go |

### 2.3 Variables d'environnement du backend

| Variable | Valeur | Remarque |
|---|---|---|
| `NODE_ENV` | `production` | active CORS strict et contrôles de sécurité |
| `NODE_VERSION` | `22` | `better-sqlite3` 12 exige Node 22 ou plus |
| `DB_PATH` | `/var/data/data.sqlite` | sur le disque persistant |
| `JWT_SECRET` | 32 caractères aléatoires minimum | généré par le Blueprint ; **le serveur refuse de démarrer sinon** |
| `FRONTEND_URL` | `https://<votre-app>.vercel.app` | origine(s) autorisée(s) par CORS, séparées par des virgules ; sert aussi d'URL de retour FedaPay |
| `CORS_ALLOW_VERCEL_PREVIEWS` | `false` | `true` pour autoriser les prévisualisations `*.vercel.app` |
| `ADMIN_EMAIL` | votre email | admin créé au 1er démarrage s'il n'existe pas |
| `ADMIN_PASSWORD` | 10 caractères minimum | à **supprimer** une fois l'admin créé |
| `ADMIN_NAME` | ex. `Jacques KORGO` | facultatif |
| `FEDAPAY_ENVIRONMENT` | `sandbox` puis `live` | |
| `FEDAPAY_SECRET_KEY` | `sk_sandbox_…` / `sk_live_…` | sans clé : paiement simulé |
| `FEDAPAY_PUBLIC_KEY` | `pk_sandbox_…` / `pk_live_…` | |
| `FEDAPAY_WEBHOOK_SECRET` | `wh_sandbox_…` / `wh_live_…` | Workbench → Webhooks → « Click to reveal » |
| `SUBSCRIPTION_CURRENCY` | `XOF` | |

`PORT` est fourni automatiquement par Render (le serveur écoute `process.env.PORT`).

### 2.4 Premier administrateur
Au premier démarrage avec `ADMIN_EMAIL` et `ADMIN_PASSWORD`, les journaux affichent
`[admin] Compte administrateur créé : …`. Connectez-vous, puis **supprimez `ADMIN_PASSWORD`** dans Render.

---

## 3. Frontend sur Vercel

1. Vercel → **Add New** → **Project** → importez le dépôt.
2. **Root Directory** : `client` (important).
3. Framework : **Vite** (détecté). Build : `npm run build`, sortie : `dist` (déjà dans `client/vercel.json`).
4. Variable d'environnement (Settings → Environment Variables, environnement *Production*) :
   - `VITE_API_URL` = `https://<votre-backend>.onrender.com` (sans `/` final).
   Alternative : remplir `client/.env.production` et le pousser sur Git (la variable Vercel est prioritaire).
5. **Deploy**. Notez l'URL : `https://<votre-app>.vercel.app`.
6. `client/vercel.json` redirige toutes les routes (`/carte`, `/livreur`, `/aide`…) vers `index.html` pour React Router,
   sans toucher au service worker (`sw.js`), au manifeste ni aux icônes.

⚠️ `VITE_API_URL` est intégrée **au moment du build** : après l'avoir modifiée, relancez un déploiement (Redeploy).

---

## 4. Relier les deux

1. Sur Render, mettez `FRONTEND_URL=https://<votre-app>.vercel.app` (puis **Save** : redémarrage automatique).
2. Ouvrez l'application Vercel, connectez-vous avec l'admin, vérifiez :
   - connexion et inscription ;
   - carte et temps réel (positions des livreurs, messages) : Socket.io passe en WebSocket vers Render ;
   - géolocalisation : fonctionne car Vercel est en HTTPS ;
   - installation PWA : bouton « Installer » sur Android, « Sur l'écran d'accueil » sur iPhone.
3. Domaine personnalisé (facultatif) : ajoutez-le dans Vercel, puis **ajoutez-le aussi** à `FRONTEND_URL` sur Render
   (ex. `https://app.mondomaine.bf,https://<votre-app>.vercel.app`).

## 5. FedaPay en production

1. Webhook FedaPay (Workbench → Webhooks) : `https://<votre-backend>.onrender.com/api/webhooks/fedapay`,
   évènements `transaction.approved`, `transaction.declined`, `transaction.canceled`.
2. Copiez le secret du webhook dans `FEDAPAY_WEBHOOK_SECRET`.
3. Testez d'abord en `sandbox`, puis passez en `live` : clés `live`, `FEDAPAY_ENVIRONMENT=live`,
   **nouveau webhook en mode Live** (secret différent).

---

## 6. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| « Network Error » dans le navigateur | `FRONTEND_URL` ne correspond pas exactement à l'URL Vercel | corrigez la variable sur Render (https, sans `/` final). Les journaux Render affichent `[cors] origine refusée : …` |
| Le service Render s'arrête au démarrage | `JWT_SECRET` absent ou trop court | 32 caractères minimum |
| Données perdues après un déploiement | pas de disque, ou `DB_PATH` hors de `/var/data` | ajoutez le disque et `DB_PATH=/var/data/data.sqlite` |
| Page 404 en rechargeant `/carte` sur Vercel | Root Directory différent de `client` | réglez Root Directory sur `client` |
| Les appels partent vers `votre-backend.onrender.com` | `VITE_API_URL` non renseignée | définissez-la dans Vercel puis Redeploy |
| Abonnement non activé après paiement | webhook FedaPay non reçu | vérifiez l'URL et le secret du webhook ; le bouton « Vérifier mon statut » relit la transaction chez FedaPay |
| Premier chargement lent | instance en veille (offres gratuites) | utilisez une offre sans mise en veille |

## 7. Développement local (inchangé)

`.\start.bat` à la racine. `npm run dev` (serveur) ajoute `--dev` : le mode développement reste actif même si
`NODE_ENV=production` est défini globalement sur la machine (CORS ouvert, pas de contrôle JWT_SECRET).
