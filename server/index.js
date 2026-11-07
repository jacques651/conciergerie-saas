// Point d'entrée du serveur Express + Socket.io.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

require('./db'); // initialise la base + schéma
require('./services/bootstrapAdmin')(); // crée l'admin initial en production (ADMIN_EMAIL / ADMIN_PASSWORD)
const { initSocket } = require('./socket/handlers');
const { startSubscriptionCron } = require('./services/subscriptionCron');

// Port dynamique : Render (et la plupart des hébergeurs) fournit PORT
const PORT = process.env.PORT || 4000;
// NB : « npm run dev » passe --dev → toujours en mode développement, même si NODE_ENV=production
// est défini globalement sur la machine (cas fréquent sous Windows).
const IS_PROD = process.env.NODE_ENV === 'production' && !process.argv.includes('--dev');

// ---------- CORS ----------
// Production : seules les origines déclarées sont autorisées
//   FRONTEND_URL   = https://mon-app.vercel.app            (plusieurs : séparées par des virgules)
//   CORS_ALLOW_VERCEL_PREVIEWS=true → autorise aussi les déploiements de prévisualisation *.vercel.app
// Développement : toute origine (réseau local, tunnel…)
const allowedOrigins = [process.env.FRONTEND_URL, process.env.CLIENT_ORIGIN]
  .filter(Boolean)
  .flatMap((v) => v.split(','))
  .map((v) => v.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const allowPreviews = process.env.CORS_ALLOW_VERCEL_PREVIEWS === 'true';
const rejectedLogged = new Set();
function corsOrigin(origin, callback) {
  if (!IS_PROD) return callback(null, true);
  // Requêtes sans origine (webhook FedaPay, curl, contrôle de santé Render) : pas de CORS à appliquer
  if (!origin) return callback(null, true);
  const o = origin.replace(/\/+$/, '');
  if (allowedOrigins.includes(o) || (allowPreviews && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(o))) return callback(null, true);
  // Origine refusée : pas d'en-tête CORS → le navigateur bloque la réponse (sans erreur 500 côté serveur)
  if (!rejectedLogged.has(o)) { rejectedLogged.add(o); console.warn(`[cors] origine refusée : ${origin}`); }
  return callback(null, false);
}
if (IS_PROD && !allowedOrigins.length) console.warn('[cors] FRONTEND_URL non défini : le frontend ne pourra pas joindre l\'API');

const app = express();
app.set('trust proxy', 1); // derrière le proxy HTTPS de Render
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin, credentials: true } });
app.set('io', io); // accessible dans les routes via req.app.get('io')

app.use(cors({ origin: corsOrigin, credentials: true }));
// Webhook FedaPay : route PUBLIQUE, déclarée AVANT express.json car la signature
// se vérifie sur le corps BRUT de la requête.
const payment = require('./services/payment');
app.post('/api/webhooks/fedapay', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => payment.handleWebhook(req, res));

app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Routes non soumises à l'abonnement : /auth, /subscription, /admin
app.use('/api/auth', require('./routes/auth'));
app.use('/api/subscription', require('./routes/subscription'));
app.use('/api/admin', require('./routes/admin'));
// Routes soumises (middleware appliqué dans chaque routeur)
app.use('/api/livreur', require('./routes/livreur'));
app.use('/api/client', require('./routes/client'));
app.use('/api/commercant', require('./routes/commercant'));
app.use('/api/messages', require('./routes/messages'));
// Notes : /api/missions/:id/review et /api/users/:id/reviews
app.use('/api', require('./routes/reviews'));

// 404 API
app.use('/api', (req, res) => res.status(404).json({ error: 'Route introuvable' }));

// Gestionnaire d'erreurs global (JSON invalide, etc.)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide' });
  console.error('[erreur]', err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur' });
});

payment.setIo(io); // pour émettre "subscription:activated"
initSocket(io);
startSubscriptionCron(io);

// Démarrage : 0.0.0.0 pour être joignable dans le conteneur Render
server.listen(PORT, '0.0.0.0', () => console.log(`✅ API + Socket.io sur le port ${PORT}${IS_PROD ? ` · CORS : ${allowedOrigins.join(', ') || 'aucune origine'}` : ''}`));
