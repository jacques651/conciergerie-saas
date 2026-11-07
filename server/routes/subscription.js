// Abonnements : formules journalière / mensuelle / annuelle (tarifs configurables par l'admin).
// Pas de middleware d'abonnement ici, évidemment.
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { getActiveSubscription } = require('../db');
const payment = require('../services/payment');

// GET /api/subscription/plans — PUBLIC : formules et tarifs actuels
router.get('/plans', (req, res) => {
  try { res.json({ currency: payment.CURRENCY, plans: payment.getPlans(), provider: payment.PROVIDER, environment: payment.PROVIDER === 'fedapay' ? payment.FEDAPAY_ENVIRONMENT : null }); }
  catch (e) { console.error('[plans]', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Toutes les routes suivantes exigent d'être connecté
router.use(requireAuth);

// POST /api/subscription/pay { plan: "daily" | "monthly" | "yearly" } → paiement "pending"
router.post('/pay', async (req, res) => {
  try {
    if (req.user.role === 'admin') return res.status(400).json({ error: "L'admin n'est pas soumis à l'abonnement" });
    const plan = req.body?.plan || 'daily';
    // FedaPay : renvoie payment_url (page de paiement Orange Money / Moov Money) ; simulé : payment_url = null
    const r = await payment.initPayment(req.user, plan);
    res.status(201).json(r);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Erreur serveur' });
  }
});

// POST /api/subscription/confirm { paymentId }
// Vérifie le paiement côté serveur (FedaPay : relecture de la transaction ; simulé : activation directe).
// Utilisé au retour de FedaPay et par le bouton « Vérifier mon statut » (utile si le webhook n'a pas pu arriver).
router.post('/confirm', async (req, res) => {
  try {
    const { paymentId } = req.body || {};
    if (!paymentId) return res.status(400).json({ error: 'paymentId requis' });
    const r = await payment.confirmPayment(Number(paymentId), req.user.id);
    res.json({ status: r.status, expires_at: r.expires_at, plan: r.plan });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Erreur serveur' });
  }
});

// GET /api/subscription/status
router.get('/status', (req, res) => {
  if (req.user.role === 'admin') return res.json({ active: true, expires_at: null, daysLeft: null, exempt: true });
  const sub = getActiveSubscription(req.user.id);
  if (!sub) return res.json({ active: false, expires_at: null, daysLeft: 0 });
  const ms = Date.parse(sub.expires_at) - Date.now();
  res.json({ active: true, expires_at: sub.expires_at, plan: sub.plan, daysLeft: Math.round((ms / 86400000) * 100) / 100 });
});

module.exports = router;
