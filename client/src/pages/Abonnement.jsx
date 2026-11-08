// Page d'abonnement : choix de la formule (journalière / mensuelle / annuelle),
// tarifs chargés dynamiquement, confirmation du montant, compte à rebours temps réel.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { errMsg } from '../api';
import { useAuth, homeFor } from '../auth.jsx';
import { getSocket } from '../socket';
import AppLayout from '../components/AppLayout.jsx';

const pad = (n) => String(n).padStart(2, '0');

/** Durée restante : "J j HH:MM:SS" au-delà de 24 h, sinon "HH:MM:SS" */
export function formatRemaining(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hms = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return d > 0 ? `${d} j ${hms}` : hms;
}

export const fcfa = (n) => `${Number(n || 0).toLocaleString('fr-FR')} FCFA`;

const PLAN_INFO = {
  daily:   { icon: '☀️', period: '24 heures', unit: 'jour' },
  monthly: { icon: '📅', period: '30 jours',  unit: 'mois' },
  yearly:  { icon: '🏆', period: '365 jours', unit: 'an' }
};

export default function Abonnement() {
  const { user, subscription, refreshSubscription } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [now, setNow] = useState(Date.now());
  const [plans, setPlans] = useState([]);
  const [plansError, setPlansError] = useState('');
  const [selected, setSelected] = useState(null); // formule en attente de confirmation
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(params.get('expired') ? { type: 'error', text: 'Votre abonnement a expiré.' } : null);
  const [provider, setProvider] = useState({ provider: 'simulated', environment: null });

  // ---------- Retour de FedaPay : /abonnement?retour=fedapay&paymentId=…(&id=…&status=…) ----------
  const returnPaymentId = params.get('retour') === 'fedapay' ? params.get('paymentId') : null;
  const returnStatus = params.get('status'); // indicatif seulement : le serveur revérifie auprès de FedaPay
  const [pending, setPending] = useState(returnPaymentId ? { paymentId: returnPaymentId, state: 'checking' } : null);
  const [checking, setChecking] = useState(false);

  /** Vérification serveur (POST /confirm interroge FedaPay) puis lecture du statut (GET /status) */
  const verify = useCallback(async (paymentId) => {
    if (!paymentId) return;
    setChecking(true);
    try {
      const { data } = await api.post('/subscription/confirm', { paymentId });
      const st = await refreshSubscription();
      if (data.status === 'active' || st?.active) {
        setPending({ paymentId, state: 'active' });
        getSocket()?.emit('subscription:refresh');
        setMsg({ type: 'success', text: `✅ Paiement confirmé : abonnement actif jusqu'au ${new Date(data.expires_at || st.expires_at).toLocaleString('fr-FR')}.` });
      } else {
        setPending({ paymentId, state: 'pending' });
      }
    } catch (e) {
      setPending({ paymentId, state: 'failed', error: errMsg(e) });
    } finally { setChecking(false); }
  }, [refreshSubscription]);

  useEffect(() => { if (returnPaymentId) verify(returnPaymentId); }, [returnPaymentId, verify]);

  // Activation poussée par le webhook (socket "subscription:activated")
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onActivated = ({ expires_at }) => {
      refreshSubscription();
      setPending((p) => (p ? { ...p, state: 'active' } : p));
      setMsg({ type: 'success', text: `✅ Paiement reçu : abonnement actif jusqu'au ${new Date(expires_at).toLocaleString('fr-FR')}.` });
    };
    const onFailed = () => setPending((p) => (p ? { ...p, state: 'failed', error: 'Le paiement a été refusé ou annulé.' } : p));
    s.on('subscription:activated', onActivated);
    s.on('subscription:failed', onFailed);
    return () => { s.off('subscription:activated', onActivated); s.off('subscription:failed', onFailed); };
  }, [refreshSubscription]);

  useEffect(() => { refreshSubscription(); }, [refreshSubscription]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    api.get('/subscription/plans')
      .then(({ data }) => { setPlans(data.plans); setProvider({ provider: data.provider, environment: data.environment }); })
      .catch((e) => setPlansError(errMsg(e)));
  }, []);

  const expiresMs = subscription?.expires_at ? Date.parse(subscription.expires_at) - now : 0;
  const active = subscription?.active && expiresMs > 0;
  const daily = plans.find((p) => p.id === 'daily');

  // Paiement :
  //  - FedaPay  : POST /pay → payment_url → redirection vers la page Orange Money / Moov Money
  //  - simulé   : POST /pay puis POST /confirm (activation immédiate)
  const pay = async () => {
    if (!selected) return;
    setLoading(true); setMsg(null);
    try {
      const { data: p } = await api.post('/subscription/pay', { plan: selected.id });
      if (p.payment_url) {
        window.location.href = p.payment_url; // retour sur /abonnement?retour=fedapay&paymentId=…
        return; // on garde l'état "chargement" pendant la redirection
      }
      const { data: c } = await api.post('/subscription/confirm', { paymentId: p.paymentId });
      await refreshSubscription();
      getSocket()?.emit('subscription:refresh');
      setMsg({ type: 'success', text: `✅ Paiement de ${fcfa(p.amount)} confirmé : formule ${selected.label.toLowerCase()} active jusqu'au ${new Date(c.expires_at).toLocaleString('fr-FR')}.` });
      setSelected(null);
    } catch (e) { setMsg({ type: 'error', text: errMsg(e) }); }
    finally { setLoading(false); }
  };

  return (
    <AppLayout title="Mon abonnement">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        {/* ---- Retour de FedaPay : paiement en attente / confirmé / échoué ---- */}
        {pending && (
          <div className={`tk-form-section space-y-3 ${pending.state === 'failed' ? '!border-t-[var(--tk-danger)]' : ''}`}>
            <h2 className="tk-card-title text-lg font-semibold">
              {pending.state === 'active' ? 'Paiement confirmé' : pending.state === 'failed' ? 'Paiement non abouti' : 'Paiement en attente'}
            </h2>
            {pending.state === 'checking' && <p className="text-sm text-gray-500">Vérification de votre paiement auprès de FedaPay…</p>}
            {pending.state === 'pending' && (
              <p className="tk-alert tk-alert-warning">
                Votre paiement (n° {pending.paymentId}) n'est pas encore confirmé
                {returnStatus ? ` (statut reçu : ${returnStatus})` : ''}. Validez l'opération sur votre téléphone
                (Orange Money / Moov Money), puis cliquez sur « Vérifier mon statut ». L'activation est automatique dès réception de la confirmation.
              </p>
            )}
            {pending.state === 'failed' && <p className="tk-alert tk-alert-danger">{pending.error || 'Le paiement a échoué.'} Vous pouvez réessayer ci-dessous.</p>}
            {pending.state === 'active' && <p className="tk-alert tk-alert-success">Merci ! Votre abonnement est actif.</p>}
            <div className="flex flex-wrap gap-2">
              {pending.state !== 'active' && (
                <button className="btn-primary" disabled={checking} onClick={() => verify(pending.paymentId)}>
                  {checking ? 'Vérification…' : 'Vérifier mon statut'}
                </button>
              )}
              <button className="btn-ghost" onClick={() => { setPending(null); nav('/abonnement', { replace: true }); }}>Fermer</button>
            </div>
          </div>
        )}

        {/* ---- Statut actuel ---- */}
        <div className="card text-center">
          {active ? (
            <>
              <span className="badge bg-green-100 text-green-800">Actif</span>
              <p className="mt-2 text-sm">jusqu'au <b>{new Date(subscription.expires_at).toLocaleString('fr-FR')}</b></p>
              <p className="mt-2 font-mono text-3xl font-bold tabular-nums text-brand sm:text-4xl">{formatRemaining(expiresMs)}</p>
              <p className="text-xs text-gray-400">temps restant</p>
            </>
          ) : (
            <>
              <span className="badge bg-red-100 text-red-700">Expiré / inactif</span>
              <p className="mt-2 text-sm text-gray-600">Choisissez une formule pour accéder à la carte, aux missions et à la messagerie.</p>
            </>
          )}
        </div>

        {msg && (
          <p className={`tk-alert text-center ${msg.type === 'success' ? 'tk-alert-success' : 'tk-alert-danger'}`}>{msg.text}</p>
        )}

        {/* ---- Formules ---- */}
        <section>
          <h2 className="mb-3 text-center text-lg font-semibold">{active ? 'Prolonger mon abonnement' : 'Choisissez votre formule'}</h2>
          <p className="tk-alert tk-alert-info mb-3 text-center text-sm">
            {provider.provider === 'fedapay'
              ? 'Vous serez redirigé vers FedaPay pour payer en toute sécurité via Orange Money ou Moov Money.'
              : 'Mode démonstration : le paiement est simulé et votre abonnement est activé immédiatement après validation.'}
          </p>
          {plansError && <p className="text-center text-sm text-red-600">Impossible de charger les tarifs : {plansError}</p>}
          {!plans.length && !plansError && <p className="text-center text-sm text-gray-400">Chargement des tarifs…</p>}

          <div className="grid gap-3 sm:grid-cols-3">
            {plans.map((p) => {
              const info = PLAN_INFO[p.id] || {};
              // Économie par rapport au tarif journalier sur la même période
              const saving = daily && p.id !== 'daily' ? Math.round((1 - p.amount / (daily.amount * p.days)) * 100) : 0;
              const isSel = selected?.id === p.id;
              return (
                <button key={p.id} type="button" onClick={() => setSelected(p)} disabled={loading}
                  className={`card relative flex flex-col items-center gap-1 text-center transition hover:shadow-md ${isSel ? 'ring-2 ring-brand' : ''}`}>
                  {saving > 0 && <span className="absolute -top-2 right-2 rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white">−{saving} %</span>}
                  <span className="text-3xl">{info.icon}</span>
                  <span className="font-semibold">{p.label}</span>
                  <span className="text-2xl font-bold text-brand">{fcfa(p.amount)}</span>
                  <span className="text-xs text-gray-500">par {info.unit} · accès {info.period}</span>
                  <span className={`mt-2 w-full rounded-lg py-1.5 text-sm font-medium ${isSel ? 'bg-brand text-white' : 'bg-brand-light text-brand'}`}>
                    {isSel ? 'Sélectionné' : 'Choisir'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ---- Confirmation du montant ---- */}
        {selected && (
          <div className="tk-form-section space-y-3">
            <h3 className="font-semibold">Confirmer le paiement</h3>
            <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3 text-sm">
              <span>Formule {selected.label.toLowerCase()} ({PLAN_INFO[selected.id]?.period})</span>
              <b className="text-lg text-brand">{fcfa(selected.amount)}</b>
            </div>
            {active && (
              <p className="text-xs text-gray-500">La durée s'ajoute à votre abonnement en cours (jusqu'au {new Date(subscription.expires_at).toLocaleDateString('fr-FR')}).</p>
            )}
            <div className="flex gap-2">
              <button onClick={pay} disabled={loading} className="btn-primary flex-1 py-3">
                {loading ? (provider.provider === 'fedapay' ? 'Redirection vers FedaPay…' : 'Paiement en cours…') : `Payer ${fcfa(selected.amount)}`}
              </button>
              <button onClick={() => setSelected(null)} disabled={loading} className="btn-ghost">Annuler</button>
            </div>
            {provider.provider === 'fedapay' ? (
              <p className="text-center text-xs text-gray-500">
                Paiement sécurisé par FedaPay · Orange Money, Moov Money
                {provider.environment === 'sandbox' && <span className="badge tk-badge-warning ml-2">Mode test : aucun argent réel</span>}
              </p>
            ) : (
              <p className="text-center text-xs text-gray-400">Paiement simulé (mode développement) · configurez FedaPay pour encaisser.</p>
            )}
          </div>
        )}

        {active && (
          <button onClick={() => nav(homeFor(user.role))} className="btn-ghost w-full">Accéder à mon espace →</button>
        )}
      </div>
    </AppLayout>
  );
}
