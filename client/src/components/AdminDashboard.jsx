// Tableau de bord administrateur : indicateurs globaux (GET /api/admin/stats).
// Graphiques : barres horizontales simples, une seule teinte (magnitude), valeurs en texte.
import { useEffect, useState } from 'react';
import { Package, Users, Wallet, Bike, Trophy, Star, RefreshCw, CalendarDays, UserCheck } from 'lucide-react';
import api, { errMsg } from '../api';

const fcfa = (n) => `${Number(n || 0).toLocaleString('fr-FR')} FCFA`;
const MISSION_LABEL = { pending: 'En attente', accepted: 'Acceptées', en_cours: 'En cours', livree: 'Livrées', refused: 'Refusées', annulee: 'Annulées' };
const ROLE_LABEL = { client: 'Clients', commercant: 'Commerçants', livreur: 'Livreurs', admin: 'Administrateurs' };
const PLAN_LABEL = { daily: 'Journalier', monthly: 'Mensuel', yearly: 'Annuel' };

function Kpi({ icon: Icon, label, value, hint }) {
  return (
    <div className="tk-kpi">
      <span className="tk-kpi-icon"><Icon size={18} /></span>
      <div className="min-w-0">
        <p className="tk-kpi-label">{label}</p>
        <p className="tk-kpi-value">{value}</p>
        {hint && <p className="text-xs text-gray-500">{hint}</p>}
      </div>
    </div>
  );
}

/** Barres horizontales : [{ label, value, display? }] */
function Bars({ rows, format = (v) => v }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="tk-bars" role="table">
      {rows.map((r) => (
        <div key={r.label} className="tk-bar-row" role="row" title={`${r.label} : ${format(r.value)}`}>
          <span className="tk-bar-label" role="cell">{r.label}</span>
          <span className="tk-bar-track" role="cell" aria-hidden><span className="tk-bar-fill block" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="tk-bar-value" role="cell">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, children, className = '' }) {
  return (
    <section className={`card space-y-4 p-5 ${className}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    return api.get('/admin/stats').then((r) => { setStats(r.data); setError(''); })
      .catch((e) => setError(errMsg(e))).finally(() => setLoading(false));
  };
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);

  if (error && !stats) return <p className="tk-alert tk-alert-danger">{error}</p>;
  if (!stats) return <p className="text-sm text-gray-500">Chargement des statistiques…</p>;

  const { missions, users, revenue, topLivreurs } = stats;
  const deliveredRate = missions.total ? Math.round((missions.byStatus.livree / missions.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-500">Mise à jour automatique chaque minute · abonnements de démonstration exclus du chiffre d'affaires</p>
        <button className="btn-ghost px-3 py-1.5 text-sm" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualiser
        </button>
      </div>

      {/* KPI principaux */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Package} label="Missions" value={missions.total} hint={`${missions.byStatus.livree} livrées · ${deliveredRate} %`} />
        <Kpi icon={Users} label="Utilisateurs" value={users.total} hint={`${users.livreursOnline} livreur(s) en ligne`} />
        <Kpi icon={Wallet} label="CA abonnements" value={fcfa(revenue.total)} hint={`${revenue.activeSubscribers} abonné(s) actif(s)`} />
        <Kpi icon={CalendarDays} label="CA du mois" value={fcfa(revenue.month)} hint={`Courses livrées : ${fcfa(missions.deliveredValue)}`} />
      </div>
      {users.livreursPending > 0 && (
        <p className="tk-alert tk-alert-warning flex items-center gap-2"><UserCheck size={16} /> {users.livreursPending} livreur(s) en attente de validation (onglet Recrutement).</p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Missions par statut">
          <Bars rows={Object.entries(missions.byStatus).map(([k, v]) => ({ label: MISSION_LABEL[k] || k, value: v }))} />
        </Panel>
        <Panel title="Utilisateurs par rôle">
          <Bars rows={['client', 'commercant', 'livreur', 'admin'].map((k) => ({ label: ROLE_LABEL[k], value: users.byRole[k] || 0 }))} />
        </Panel>
        <Panel title="Chiffre d'affaires par formule">
          <Bars rows={Object.entries(revenue.byPlan).map(([k, v]) => ({ label: PLAN_LABEL[k] || k, value: v }))} format={fcfa} />
        </Panel>
        <Panel title="Top 3 des livreurs">
          {topLivreurs.length === 0 && <p className="text-sm text-gray-500">Aucune mission livrée pour le moment.</p>}
          <ol className="space-y-2">
            {topLivreurs.map((l, i) => (
              <li key={l.id} className="tk-detail-tile flex items-center gap-3">
                <span className="tk-kpi-icon">{i === 0 ? <Trophy size={18} /> : <Bike size={18} />}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{i + 1}. {l.name}</p>
                  <p className="text-xs text-gray-500">
                    {l.delivered} livraison(s) · {fcfa(l.earnings)}
                    {l.rating != null && <> · <Star size={11} className="tk-star-on inline -mt-0.5" fill="currentColor" /> {String(l.rating).replace('.', ',')}/5 ({l.reviews})</>}
                  </p>
                </div>
                <span className="tk-money">{l.delivered}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}
