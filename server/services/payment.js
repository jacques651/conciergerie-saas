// =============================================================
// Module de paiement : POINT UNIQUE d'intégration Mobile Money (FedaPay).
//
// Interface publique :
//   initPayment(user | userId, plan)  -> { paymentId, plan, amount, currency, payment_url, transactionRef, provider }
//   confirmPayment(paymentId, userId) -> { expires_at, plan, status }   (vérification côté serveur auprès de FedaPay)
//   handleWebhook(req, res)           -> route publique POST /api/webhooks/fedapay (corps BRUT requis)
//   activateSubscription(subId, method) (aussi utilisé par l'activation manuelle admin)
//   setIo(io)                         -> permet d'émettre "subscription:activated"
//
// Fournisseur :
//   - "fedapay"   : vraie transaction Orange Money / Moov Money (sandbox par défaut)
//   - "simulated" : paiement fictif (repli automatique si FEDAPAY_SECRET_KEY est vide)
// =============================================================
const crypto = require('crypto');
const { db, getLatestExpiry, getPrices } = require('../db');

const CURRENCY = process.env.SUBSCRIPTION_CURRENCY || 'XOF';
const HOUR = 3600 * 1000;

// ---------- Configuration FedaPay ----------
const FEDAPAY_SECRET_KEY = (process.env.FEDAPAY_SECRET_KEY || '').trim();
const FEDAPAY_ENVIRONMENT = (process.env.FEDAPAY_ENVIRONMENT || 'sandbox').trim().toLowerCase() === 'live' ? 'live' : 'sandbox';
const FEDAPAY_WEBHOOK_SECRET = (process.env.FEDAPAY_WEBHOOK_SECRET || '').trim();
const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '');
// Fournisseur : explicite (PAYMENT_PROVIDER) sinon FedaPay dès qu'une clé secrète est présente
const PROVIDER = (process.env.PAYMENT_PROVIDER || (FEDAPAY_SECRET_KEY ? 'fedapay' : 'simulated')).trim().toLowerCase();

let FedaPaySDK = null;
if (PROVIDER === 'fedapay') {
  if (!FEDAPAY_SECRET_KEY) {
    console.warn('[paiement] PAYMENT_PROVIDER=fedapay mais FEDAPAY_SECRET_KEY est vide : les paiements échoueront.');
  }
  FedaPaySDK = require('fedapay');
  FedaPaySDK.FedaPay.setApiKey(FEDAPAY_SECRET_KEY);
  FedaPaySDK.FedaPay.setEnvironment(FEDAPAY_ENVIRONMENT);
  if (FEDAPAY_ENVIRONMENT === 'live' && FEDAPAY_SECRET_KEY.startsWith('sk_sandbox')) {
    console.warn('[paiement] FEDAPAY_ENVIRONMENT=live avec une clé sandbox : vérifiez votre .env');
  }
  console.log(`[paiement] FedaPay activé (${FEDAPAY_ENVIRONMENT})${FEDAPAY_WEBHOOK_SECRET ? '' : ' · ATTENTION : FEDAPAY_WEBHOOK_SECRET absent, webhooks refusés'}`);
} else {
  console.log('[paiement] Mode simulé (aucune clé FedaPay) : renseignez FEDAPAY_SECRET_KEY pour activer FedaPay.');
}

// Formules disponibles : durée + clé de prix dans la table settings
const PLANS = {
  daily:   { label: 'Journalier', durationMs: 24 * HOUR,       days: 1,   priceKey: 'price_daily' },
  monthly: { label: 'Mensuel',    durationMs: 30 * 24 * HOUR,  days: 30,  priceKey: 'price_monthly' },
  yearly:  { label: 'Annuel',     durationMs: 365 * 24 * HOUR, days: 365, priceKey: 'price_yearly' }
};

class PaymentError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Accès Socket.io (injecté par index.js) pour notifier l'activation
let io = null;
const setIo = (instance) => { io = instance; };

/** Liste des formules avec leur prix actuel (lu en base) */
function getPlans() {
  const prices = getPrices();
  return Object.entries(PLANS).map(([id, p]) => ({
    id, label: p.label, days: p.days, amount: prices[p.priceKey], currency: CURRENCY
  }));
}

function assertPlan(plan) {
  if (!PLANS[plan]) throw new PaymentError('Formule invalide (daily, monthly ou yearly)', 400);
  return PLANS[plan];
}

/** Message d'erreur lisible depuis une erreur du SDK FedaPay */
function fedapayErrorMessage(e) {
  // Erreurs du SDK : errorMessage / errors (corps de réponse FedaPay), httpStatus
  const data = e?.httpResponse?.data || e?.response?.data || {};
  const errs = e?.errors || data.errors;
  const detail = e?.errorMessage || data.message || (errs && JSON.stringify(errs));
  return detail ? `FedaPay : ${detail}` : `FedaPay : ${e?.message || 'erreur inconnue'}`;
}

/** Numéro burkinabè au format attendu par FedaPay (8 chiffres), sinon null */
function bfPhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('00226')) digits = digits.slice(5);
  else if (digits.startsWith('226') && digits.length === 11) digits = digits.slice(3);
  return /^\d{8}$/.test(digits) ? digits : null;
}

// =============================================================
// Activation (commune : webhook, vérification manuelle, admin, simulé)
// =============================================================
/**
 * Active un abonnement : expires_at = max(now, expiration actuelle) + durée de la formule
 * (daily = 24 h, monthly = 30 j, yearly = 365 j). Idempotent : un abonnement déjà actif n'est pas prolongé deux fois.
 */
function activateSubscription(subId, method) {
  const result = db.transaction(() => {
    const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subId);
    if (!sub) throw new PaymentError('Paiement introuvable', 404);
    if (sub.status === 'active') return { expires_at: sub.expires_at, plan: sub.plan, user_id: sub.user_id, alreadyActive: true };

    const def = PLANS[sub.plan] || PLANS.daily;
    const current = getLatestExpiry(sub.user_id);
    const base = Math.max(Date.now(), current ? Date.parse(current) : 0);
    const startsAt = new Date(base).toISOString();
    const expiresAt = new Date(base + def.durationMs).toISOString();

    db.prepare(`UPDATE subscriptions SET status = 'active', starts_at = ?, expires_at = ?,
                  payment_method = COALESCE(?, payment_method) WHERE id = ?`)
      .run(startsAt, expiresAt, method || null, subId);
    return { expires_at: expiresAt, plan: sub.plan, user_id: sub.user_id, alreadyActive: false };
  })();

  // Notification temps réel + retour dans la room "realtime" (carte, missions…)
  if (!result.alreadyActive && io) {
    io.to(`user:${result.user_id}`).emit('subscription:activated', { userId: result.user_id, expires_at: result.expires_at, plan: result.plan });
    io.in(`user:${result.user_id}`).socketsJoin('realtime');
  }
  return { expires_at: result.expires_at, plan: result.plan, alreadyActive: result.alreadyActive };
}

// =============================================================
// Initialisation du paiement
// =============================================================
async function initPayment(userOrId, plan = 'daily') {
  const def = assertPlan(plan);
  const userId = typeof userOrId === 'object' ? userOrId.id : userOrId;
  const user = db.prepare('SELECT id, email, name, phone FROM users WHERE id = ?').get(userId);
  if (!user) throw new PaymentError('Utilisateur introuvable', 404);
  const amount = getPrices()[def.priceKey];
  if (!(amount > 0)) throw new PaymentError('Tarif non configuré pour cette formule', 500);

  // 1) Enregistrement local "pending" (avant tout appel externe)
  const localRef = `SUB-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const { lastInsertRowid: subId } = db.prepare(
    `INSERT INTO subscriptions (user_id, amount, currency, status, plan, payment_method, transaction_ref)
     VALUES (?, ?, ?, 'pending', ?, ?, ?)`
  ).run(user.id, amount, CURRENCY, plan, PROVIDER, localRef);

  // 2a) Mode simulé : pas d'URL externe, la confirmation se fait via /confirm
  if (PROVIDER !== 'fedapay') {
    return { paymentId: subId, plan, amount, currency: CURRENCY, transactionRef: localRef, payment_url: null, provider: 'simulated' };
  }

  // 2b) FedaPay : transaction + token → URL de paiement hébergée (Orange Money, Moov Money…)
  try {
    const [firstname, ...rest] = user.name.trim().split(/\s+/);
    const customer = { firstname: firstname || user.name, lastname: rest.join(' ') || firstname || user.name, email: user.email };
    const phone = bfPhone(user.phone);
    if (phone) customer.phone_number = { number: phone, country: 'bf' };

    const transaction = await FedaPaySDK.Transaction.create({
      description: `Abonnement ${def.label} Conciergerie (#${subId})`,
      amount,
      currency: { iso: CURRENCY },
      // Retour après paiement : FedaPay ajoute ?id=…&status=… à cette URL
      callback_url: `${FRONTEND_URL}/abonnement?retour=fedapay&paymentId=${subId}`,
      customer
    });
    const token = await transaction.generateToken();

    // On remplace la référence locale par l'identifiant FedaPay (clé de rapprochement du webhook)
    db.prepare('UPDATE subscriptions SET transaction_ref = ? WHERE id = ?').run(String(transaction.id), subId);
    return {
      paymentId: subId, plan, amount, currency: CURRENCY, provider: 'fedapay',
      transactionRef: String(transaction.id), payment_url: token.url
    };
  } catch (e) {
    db.prepare(`UPDATE subscriptions SET status = 'failed' WHERE id = ?`).run(subId);
    console.error('[paiement] création FedaPay échouée', e?.message || e);
    throw new PaymentError(fedapayErrorMessage(e), 502);
  }
}

// =============================================================
// Vérification côté serveur (bouton « Vérifier mon statut », retour de FedaPay)
// Ne fait JAMAIS confiance au statut transmis par le navigateur : interroge FedaPay.
// =============================================================
async function confirmPayment(paymentId, userId) {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(paymentId);
  if (!sub) throw new PaymentError('Paiement introuvable', 404);
  if (userId && sub.user_id !== userId) throw new PaymentError('Paiement non autorisé', 403);
  if (sub.status === 'active') return { expires_at: sub.expires_at, plan: sub.plan, status: 'active' };
  if (sub.status === 'failed') throw new PaymentError('Ce paiement a échoué', 409);

  if (sub.payment_method !== 'fedapay') {
    // Paiement simulé (ou créé avant le passage à FedaPay)
    if (PROVIDER === 'fedapay') throw new PaymentError('Paiement simulé non accepté en mode FedaPay', 409);
    return { ...activateSubscription(paymentId), status: 'active' };
  }

  try {
    const tx = await FedaPaySDK.Transaction.retrieve(sub.transaction_ref);
    if (tx.status === 'approved' || tx.wasPaid?.()) return { ...activateSubscription(paymentId, 'fedapay'), status: 'active' };
    if (['declined', 'canceled', 'expired', 'refunded'].includes(tx.status)) {
      db.prepare(`UPDATE subscriptions SET status = 'failed' WHERE id = ?`).run(paymentId);
      throw new PaymentError(`Paiement ${tx.status === 'declined' ? 'refusé' : 'annulé'} (${tx.status})`, 402);
    }
    return { status: tx.status || 'pending', expires_at: null, plan: sub.plan }; // toujours en attente
  } catch (e) {
    if (e instanceof PaymentError) throw e;
    throw new PaymentError(fedapayErrorMessage(e), 502);
  }
}

// =============================================================
// Webhook FedaPay : POST /api/webhooks/fedapay (corps BRUT, sans authentification)
// =============================================================
const processedEvents = new Set(); // anti-doublon simple (les retries FedaPay renvoient le même évènement)

async function handleWebhook(req, res) {
  if (PROVIDER !== 'fedapay' || !FedaPaySDK) return res.status(404).json({ error: 'FedaPay non activé' });
  if (!FEDAPAY_WEBHOOK_SECRET) return res.status(500).json({ error: 'FEDAPAY_WEBHOOK_SECRET non configuré' });

  // 1) Vérification de la signature (en-tête X-FEDAPAY-SIGNATURE, HMAC-SHA256 sur le corps brut)
  let event;
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
    event = FedaPaySDK.Webhook.constructEvent(raw, req.headers['x-fedapay-signature'], FEDAPAY_WEBHOOK_SECRET);
  } catch (e) {
    console.warn('[webhook] signature invalide :', e.message);
    return res.status(400).json({ error: 'Signature invalide' });
  }

  // 2) Réponse rapide (2xx) puis traitement
  res.json({ received: true });

  try {
    const eventKey = event.id ? String(event.id) : null;
    if (eventKey && processedEvents.has(eventKey)) return;
    if (eventKey) { processedEvents.add(eventKey); if (processedEvents.size > 5000) processedEvents.clear(); }

    const entity = event.entity || event.object || event.data || {};
    const txId = entity.id ?? event.object_id;
    if (!txId || !String(event.name || '').startsWith('transaction.')) return;

    const sub = db.prepare(`SELECT * FROM subscriptions WHERE transaction_ref = ? AND payment_method = 'fedapay'`).get(String(txId));
    if (!sub) { console.warn(`[webhook] transaction ${txId} inconnue`); return; }

    if (event.name === 'transaction.approved' || event.name === 'transaction.transferred') {
      // Double contrôle : on relit la transaction chez FedaPay avant d'activer
      const tx = await FedaPaySDK.Transaction.retrieve(txId);
      if (tx.status === 'approved' || tx.wasPaid?.()) {
        const r = activateSubscription(sub.id, 'fedapay');
        console.log(`[webhook] abonnement #${sub.id} activé jusqu'au ${r.expires_at}`);
      }
    } else if (['transaction.declined', 'transaction.canceled'].includes(event.name) && sub.status === 'pending') {
      db.prepare(`UPDATE subscriptions SET status = 'failed' WHERE id = ?`).run(sub.id);
      io?.to(`user:${sub.user_id}`).emit('subscription:failed', { userId: sub.user_id, paymentId: sub.id });
    }
  } catch (e) {
    console.error('[webhook] erreur de traitement', e);
  }
}

module.exports = {
  initPayment, confirmPayment, handleWebhook, activateSubscription, getPlans, setIo,
  PLANS, PaymentError, CURRENCY, PROVIDER, FEDAPAY_ENVIRONMENT
};
