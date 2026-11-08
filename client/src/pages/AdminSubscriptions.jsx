// Abonnements (admin) : tableau + statistiques, et configuration des tarifs.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMsg } from '../api';
import AppLayout from '../components/AppLayout.jsx';
import { formatPhone } from '../phone';
import { Wallet, Users, Clock, Receipt } from 'lucide-react';

const fcfa = (n) => `${Number(n || 0).toLocaleString('fr-FR')} FCFA`;
const BADGE = { active: 'bg-green-100 text-green-800', pending: 'bg-amber-100 text-amber-800', expired: 'bg-gray-200 text-gray-600', failed: 'bg-red-100 text-red-700' };
const STATUS_FR = { active: 'Actif', pending: 'En attente', expired: 'Expiré', failed: 'Échoué' };
const PLAN_LABEL = { daily: 'Journalier', monthly: 'Mensuel', yearly: 'Annuel' };
const PRICE_FIELDS = [
  { key: 'price_daily', label: 'Tarif Journalier (FCFA)', hint: 'Accès 24 heures' },
  { key: 'price_monthly', label: 'Tarif Mensuel (FCFA)', hint: 'Accès 30 jours' },
  { key: 'price_yearly', label: 'Tarif Annuel (FCFA)', hint: 'Accès 365 jours' }
];

/** Formulaire de configuration des tarifs */
function PricingSettings() {
  const [form, setForm] = useState({ price_daily: '', price_monthly: '', price_yearly: '' });
  const [initial, setInitial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.get('/admin/settings')
      .then(({ data }) => { setForm(data); setInitial(data); })
      .catch((e) => setMsg({ type: 'error', text: errMsg(e) }))
      .finally(() => setLoading(false));
  }, []);

  // Validation côté client (le serveur revalide)
  const errors = Object.fromEntries(PRICE_FIELDS.map(({ key }) => {
    const n = Number(form[key]);
    return [key, form[key] === '' || !Number.isInteger(n) || n <= 0 ? 'Entier positif requis' : null];
  }));
  const hasErrors = Object.values(errors).some(Boolean);
  const dirty = initial && PRICE_FIELDS.some(({ key }) => Number(form[key]) !== Number(initial[key]));

  const save = async (e) => {
    e.preventDefault();
    if (hasErrors) return;
    setSaving(true); setMsg(null);
    try {
      const payload = Object.fromEntries(PRICE_FIELDS.map(({ key }) => [key, Number(form[key])]));
      const { data } = await api.post('/admin/settings', payload);
      const prices = { price_daily: data.price_daily, price_monthly: data.price_monthly, price_yearly: data.price_yearly };
      setForm(prices); setInitial(prices);
      setMsg({ type: 'success', text: '✅ Tarifs enregistrés. Ils s\'appliquent immédiatement aux nouveaux paiements.' });
    } catch (e) { setMsg({ type: 'error', text: errMsg(e) }); }
    finally { setSaving(false); }
  };

  // Comparaison avec le tarif journalier (aide à la décision)
  const d = Number(form.price_daily) || 0;
  const savingVs = (amount, days) => (d > 0 && amount > 0 ? Math.round((1 - amount / (d * days)) * 100) : null);

  if (loading) return <p className="text-sm text-gray-500">Chargement des tarifs…</p>;

  return (
    <form onSubmit={save} className="tk-form-section mx-auto w-full max-w-xl space-y-4">
      <div>
        <h2 className="tk-card-title text-lg font-semibold">Configuration des tarifs</h2>
        <p className="text-sm text-gray-500">Les abonnements déjà payés ne sont pas modifiés.</p>
      </div>

      {PRICE_FIELDS.map(({ key, label, hint }) => {
        const days = key === 'price_monthly' ? 30 : key === 'price_yearly' ? 365 : null;
        const s = days ? savingVs(Number(form[key]), days) : null;
        return (
          <label key={key} className="block">
            <span className="tk-label">{label}</span>
            <div className="mt-1 flex items-center gap-2">
              <input type="number" min="1" step="1" inputMode="numeric" className={`input ${errors[key] ? 'border-red-400' : ''}`}
                value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              <span className="shrink-0 text-sm text-gray-500">FCFA</span>
            </div>
            <span className="mt-0.5 block text-xs text-gray-500">
              {hint}
              {s !== null && (s > 0 ? ` · économie de ${s} % vs journalier` : s < 0 ? ` · ⚠️ plus cher que ${days} × journalier` : '')}
            </span>
            {errors[key] && <span className="text-xs text-red-600">{errors[key]}</span>}
          </label>
        );
      })}

      {msg && <p className={`tk-alert ${msg.type === 'success' ? 'tk-alert-success' : 'tk-alert-danger'}`}>{msg.text}</p>}

      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={saving || hasErrors || !dirty}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
        {dirty && <button type="button" className="btn-ghost" onClick={() => { setForm(initial); setMsg(null); }}>Annuler</button>}
      </div>
    </form>
  );
}

export default function AdminSubscriptions() {
  const [tab, setTab] = useState('abonnements');
  const [data, setData] = useState({ stats: {}, subscriptions: [] });
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => api.get('/admin/subscriptions').then((r) => setData(r.data)).catch((e) => setMsg(errMsg(e)));
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  const activate = async (s) => {
    try { const { data: r } = await api.post(`/admin/subscriptions/${s.id}/activate`); setMsg(`Abonnement #${s.id} activé jusqu'au ${new Date(r.expires_at).toLocaleString('fr-FR')}`); load(); }
    catch (e) { setMsg(errMsg(e)); }
  };

  const rows = data.subscriptions.filter((s) => !filter || s.effective_status === filter);
  const { stats } = data;

  return (
    <AppLayout title="Abonnements" actions={<Link to="/admin" className="tk-chip">← Administration</Link>}>
      <nav className="tk-pills self-start" role="tablist">
        {[['abonnements', 'Abonnements'], ['tarifs', 'Configuration des tarifs']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>

      <div className="space-y-4">
        {tab === 'tarifs' ? <PricingSettings /> : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                [Wallet, 'Revenus cumulés', fcfa(stats.revenue)],
                [Users, 'Abonnés actifs', stats.activeUsers ?? 0],
                [Clock, 'Expirent sous 6 h', stats.expiringSoon ?? 0],
                [Receipt, 'Transactions', stats.total ?? 0]
              ].map(([Icon, label, value]) => (
                <div key={label} className="tk-kpi">
                  <span className="tk-kpi-icon"><Icon size={18} /></span>
                  <div className="min-w-0"><p className="tk-kpi-label">{label}</p><p className="tk-kpi-value">{value}</p></div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400">Les abonnements de démonstration (seed) sont exclus des revenus.</p>
            {msg && <p className="tk-alert tk-alert-info">{msg}</p>}

            <div className="tk-pills" role="tablist">
              {[['', 'Tous'], ['active', 'Actifs'], ['pending', 'En attente'], ['expired', 'Expirés']].map(([v, l]) => (
                <button key={v} role="tab" aria-selected={filter === v} onClick={() => setFilter(v)}>{l}</button>
              ))}
            </div>

            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-500">
                  <tr><th className="p-2">#</th><th className="p-2">Utilisateur</th><th className="p-2">Formule</th><th className="p-2">Montant</th><th className="p-2">Statut</th><th className="p-2">Expire</th><th className="p-2">Méthode / Réf.</th><th className="p-2"></th></tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="p-2">{s.id}</td>
                      <td className="p-2">{s.name}<br /><span className="text-xs text-gray-400">{formatPhone(s.phone) || s.email || '·'} · {s.role}</span></td>
                      <td className="p-2">{PLAN_LABEL[s.plan] || s.plan || '·'}</td>
                      <td className="whitespace-nowrap p-2">{fcfa(s.amount)}</td>
                      <td className="p-2"><span className={`badge ${BADGE[s.effective_status] || ''}`}>{STATUS_FR[s.effective_status] || s.effective_status}</span></td>
                      <td className="whitespace-nowrap p-2">{s.expires_at ? new Date(s.expires_at).toLocaleString('fr-FR') : '·'}</td>
                      <td className="p-2 text-xs">{s.payment_method}<br /><span className="text-gray-400">{s.transaction_ref}</span></td>
                      <td className="p-2">{s.status === 'pending' && <button className="btn-success px-2 py-1 text-xs" onClick={() => activate(s)}>Activer</button>}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-gray-500">Aucun abonnement.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
