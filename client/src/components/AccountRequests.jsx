// Validation des inscriptions (admin) : tous les comptes clients, commerçants et livreurs.
// GET /api/admin/accounts?status=… · POST /api/admin/accounts/:id/approve|reject
import { useCallback, useEffect, useState } from 'react';
import { Check, X, RefreshCw, UserRound, Store, Bike } from 'lucide-react';
import api, { errMsg } from '../api';
import { getSocket } from '../socket';
import { useToast } from './Toast.jsx';
import { formatPhone } from '../phone';

const FILTERS = [['pending', 'En attente'], ['approved', 'Approuvés'], ['rejected', 'Rejetés'], ['all', 'Tous']];
const ROLE = { client: ['Client', UserRound], commercant: ['Commerçant', Store], livreur: ['Livreur', Bike] };
const STATUS = {
  pending: ['En attente', 'tk-badge-warning'],
  approved: ['Approuvé', 'tk-badge-success'],
  rejected: ['Rejeté', 'tk-badge-danger']
};
const fmtDate = (iso) => (iso ? new Date(iso + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z')).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '·');

export default function AccountRequests({ onCountChange }) {
  const { toast } = useToast();
  const [filter, setFilter] = useState('pending');
  const [data, setData] = useState({ accounts: [], counts: { pending: 0, approved: 0, rejected: 0 } });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    return api.get('/admin/accounts', { params: { status: filter } })
      .then((r) => { setData(r.data); setError(''); onCountChange?.(r.data.counts.pending); })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  // Nouvelle inscription en direct (room "admins")
  useEffect(() => {
    const s = getSocket();
    const onNew = ({ name, role }) => {
      toast({ type: 'info', title: "Nouvelle demande d'inscription", body: `${name} · ${ROLE[role]?.[0] || role}` });
      load();
    };
    s?.on('account:new', onNew);
    return () => s?.off('account:new', onNew);
  }, [load, toast]);

  const act = async (u, action) => {
    setBusyId(u.id);
    try {
      await api.post(`/admin/accounts/${u.id}/${action}`);
      toast({
        type: action === 'approve' ? 'success' : 'danger',
        title: action === 'approve' ? 'Compte approuvé' : 'Demande rejetée',
        body: `${u.name} · ${ROLE[u.role]?.[0] || u.role}`
      });
      load();
    } catch (e) { setError(errMsg(e)); }
    finally { setBusyId(null); }
  };

  const { counts } = data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="tk-pills" role="tablist">
          {FILTERS.map(([v, l]) => (
            <button key={v} role="tab" aria-selected={filter === v} onClick={() => setFilter(v)}>
              {l}{v !== 'all' && counts[v] > 0 && <span className={v === 'pending' ? 'tk-count' : 'text-xs opacity-70'}>{counts[v]}</span>}
            </button>
          ))}
        </div>
        <button className="btn-ghost px-3 py-1.5 text-sm" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualiser
        </button>
      </div>

      {error && <p className="tk-alert tk-alert-danger">{error}</p>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr><th>Nom</th><th>Téléphone / Email</th><th>Rôle</th><th>Inscription</th><th>Statut</th><th className="text-right">Actions</th></tr>
          </thead>
          <tbody>
            {data.accounts.map((u) => {
              const [roleLabel, RoleIcon] = ROLE[u.role] || [u.role, UserRound];
              const [stLabel, stClass] = STATUS[u.status] || [u.status, 'tk-badge-neutral'];
              return (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>
                    <span className="tk-num whitespace-nowrap font-semibold">{formatPhone(u.phone) || '·'}</span>
                    {u.email && <span className="block text-xs text-gray-500">{u.email}</span>}
                  </td>
                  <td><span className="inline-flex items-center gap-1.5"><RoleIcon size={14} /> {roleLabel}</span></td>
                  <td className="whitespace-nowrap">{fmtDate(u.created_at)}</td>
                  <td><span className={`badge ${stClass}`}>{stLabel}</span></td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      {u.status !== 'approved' && (
                        <button className="btn-primary px-3 py-1 text-xs" disabled={busyId === u.id} onClick={() => act(u, 'approve')}>
                          <Check size={14} /> Approuver
                        </button>
                      )}
                      {u.status !== 'rejected' && (
                        <button className="btn-danger px-3 py-1 text-xs" disabled={busyId === u.id} onClick={() => act(u, 'reject')}>
                          <X size={14} /> Rejeter
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && data.accounts.length === 0 && (
              <tr><td colSpan={6} className="!font-normal text-center text-gray-500">
                {filter === 'pending' ? 'Aucune demande en attente.' : 'Aucun compte.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Un compte en attente ou rejeté ne peut pas se connecter. Rejeter un compte déjà approuvé le déconnecte immédiatement.
      </p>
    </div>
  );
}
