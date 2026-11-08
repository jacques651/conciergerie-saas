// Back-office admin : tableau de bord, recrutement, création livreur, utilisateurs, carte globale.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { errMsg } from '../api';
import AppLayout from '../components/AppLayout.jsx';
import MapView from '../components/MapView.jsx';
import { useLiveLivreurs } from '../hooks';
import AdminDashboard from '../components/AdminDashboard.jsx';
import AccountRequests from '../components/AccountRequests.jsx';
import { normalizePhone, formatPhone, PHONE_HINT } from '../phone';

const STATUS_FR = { pending: 'En attente', approved: 'Approuvée', rejected: 'Rejetée' };
const BADGE = { pending: 'bg-amber-100 text-amber-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-700' };

export default function Admin() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'dashboard');
  useEffect(() => { if (params.get('tab')) setTab(params.get('tab')); }, [params]); // lien depuis une notification
  // Nombre de comptes en attente (badge de l'onglet), mis à jour par l'onglet Demandes
  const [pendingAccounts, setPendingAccounts] = useState(0);
  useEffect(() => { api.get('/admin/accounts', { params: { status: 'pending' } }).then((r) => setPendingAccounts(r.data.counts.pending)).catch(() => {}); }, [tab]);
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '' });
  const [msg, setMsg] = useState('');
  const [livreurs] = useLiveLivreurs(() => api.get('/admin/livreurs/online').then((r) => r.data));

  const loadRequests = () => api.get('/admin/recruitment', { params: filter ? { status: filter } : {} }).then((r) => setRequests(r.data)).catch(() => {});
  const loadUsers = () => api.get('/admin/users').then((r) => setUsers(r.data)).catch(() => {});
  useEffect(() => { loadRequests(); }, [filter]); // eslint-disable-line
  useEffect(() => { if (tab === 'utilisateurs') loadUsers(); }, [tab]);

  const act = async (id, action) => {
    try { await api.post(`/admin/recruitment/${id}/${action}`); loadRequests(); }
    catch (e) { setMsg(errMsg(e)); }
  };
  const grant = async (u) => {
    try { await api.post(`/admin/users/${u.id}/grant`); loadUsers(); setMsg(`+24h accordées à ${u.name}`); }
    catch (e) { setMsg(errMsg(e)); }
  };
  const createLivreur = async (e) => {
    e.preventDefault();
    const phone = normalizePhone(form.phone);
    if (!phone) return setMsg(`Numéro invalide : ${PHONE_HINT}.`);
    try {
      await api.post('/admin/livreurs', { ...form, phone, email: form.email.trim() || undefined });
      setMsg(`Livreur ${form.name} créé et approuvé : il se connecte avec le ${formatPhone(phone)}.`);
      setForm({ name: '', phone: '', email: '', password: '' });
    }
    catch (e) { setMsg(errMsg(e)); }
  };

  const TABS = [['dashboard', 'Tableau de bord'], ['demandes', pendingAccounts > 0 ? `Demandes d'inscription (${pendingAccounts})` : "Demandes d'inscription"], ['recrutement', 'Recrutement livreurs'], ['creer', 'Créer un livreur'], ['utilisateurs', 'Utilisateurs'], ['carte', `Carte (${livreurs.length})`]];

  return (
    <AppLayout title="Administration" fill={tab === 'carte'}
      actions={<Link to="/admin/subscriptions" className="tk-chip">Abonnements →</Link>}>
      <nav className="tk-pills shrink-0 self-start overflow-x-auto" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>
      {msg && <p className="tk-alert tk-alert-info cursor-pointer" onClick={() => setMsg('')}>{msg}</p>}

      <div className={tab === 'carte' ? 'tk-fill' : ''}>
        {tab === 'dashboard' && <AdminDashboard onOpenRequests={() => setTab('demandes')} />}

        {tab === 'demandes' && <AccountRequests onCountChange={setPendingAccounts} />}

        {tab === 'recrutement' && (
          <div className="space-y-3">
            <div className="tk-pills" role="tablist">
              {[['pending', 'En attente'], ['approved', 'Approuvées'], ['rejected', 'Rejetées'], ['', 'Toutes']].map(([v, l]) => (
                <button key={v} role="tab" aria-selected={filter === v} onClick={() => setFilter(v)}>{l}</button>
              ))}
            </div>
            {requests.length === 0 && <p className="text-sm text-gray-500">Aucune demande.</p>}
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {requests.map((r) => (
                <div key={r.id} className="card space-y-2">
                  <div className="flex items-center justify-between">
                    <b>{r.name}</b><span className={`badge ${BADGE[r.status]}`}>{STATUS_FR[r.status] || r.status}</span>
                  </div>
                  <p className="text-sm text-gray-600">{r.email}</p>
                  <p className="text-xs text-gray-400">{new Date(r.created_at + (r.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString('fr-FR')}</p>
                  {r.status !== 'approved' && (
                    <div className="flex gap-2">
                      <button className="btn-success flex-1 py-1" onClick={() => act(r.id, 'approve')}>Approuver</button>
                      {r.status === 'pending' && <button className="btn-danger flex-1 py-1" onClick={() => act(r.id, 'reject')}>Rejeter</button>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'creer' && (
          <form onSubmit={createLivreur} className="tk-form-section mx-auto max-w-md space-y-3">
            <h2 className="tk-card-title font-semibold">Nouveau livreur (approuvé d'office)</h2>
            <label className="block space-y-1"><span className="tk-label">Nom complet</span>
              <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="block space-y-1"><span className="tk-label">Téléphone (obligatoire, sert d'identifiant)</span>
              <input className="input" type="tel" inputMode="tel" placeholder="70 00 00 00" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label className="block space-y-1"><span className="tk-label">Email (facultatif)</span>
              <input className="input" type="email" placeholder="livreur@email.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="block space-y-1"><span className="tk-label">Mot de passe</span>
              <input className="input" type="password" minLength={4} placeholder="4 caractères minimum" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
            <p className="text-xs text-gray-500">Le livreur devra payer son abonnement (ou vous pouvez lui accorder 24h dans « Utilisateurs »).</p>
            <button className="btn-primary w-full">Créer</button>
          </form>
        )}

        {tab === 'utilisateurs' && (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr><th className="p-2">Nom</th><th className="p-2">Téléphone / Email</th><th className="p-2">Rôle</th><th className="p-2">Abonnement</th><th className="p-2"></th></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="p-2">{u.name}{u.livreur_status && <span className="ml-1 text-xs text-gray-400">({u.livreur_status})</span>}</td>
                    <td className="p-2"><span className="tk-num whitespace-nowrap">{formatPhone(u.phone) || '·'}</span>{u.email && <span className="block text-xs text-gray-500">{u.email}</span>}</td>
                    <td className="p-2">{u.role}</td>
                    <td className="p-2">
                      {u.role === 'admin' ? <span className="badge bg-gray-100">exempté</span>
                        : u.subscription_active ? <span className="badge bg-green-100 text-green-800">jusqu'au {new Date(u.subscription_expires_at).toLocaleString('fr-FR')}</span>
                        : <span className="badge bg-red-100 text-red-700">inactif</span>}
                    </td>
                    <td className="p-2">{u.role !== 'admin' && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => grant(u)}>+24h</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'carte' && <div className="h-full min-h-[400px]"><MapView livreurs={livreurs} zoom={13} /></div>}
      </div>
    </AppLayout>
  );
}
