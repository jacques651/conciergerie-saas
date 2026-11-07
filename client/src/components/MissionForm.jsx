// Formulaire de création de mission (l'adresse est choisie par clic sur la carte).
import { useEffect, useMemo, useState } from 'react';
import { MapPin, Send, Bike, UserCheck } from 'lucide-react';
import api, { errMsg } from '../api';

const EMPTY = { client_id: '', client_name: '', client_phone: '', description: '', order_details: '', delivery_price: '' };

export default function MissionForm({ livreur, destination, onCreated, onCancel }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // Clients de la plateforme (GET /api/commercant/clients) pour lier la mission à un compte
  const [clients, setClients] = useState([]);
  const [clientSearch, setClientSearch] = useState('');
  useEffect(() => { api.get('/commercant/clients').then((r) => setClients(r.data)).catch(() => {}); }, []);
  const linked = clients.find((c) => String(c.id) === String(form.client_id)) || null;
  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    return q ? clients.filter((c) => `${c.name} ${c.email} ${c.phone || ''}`.toLowerCase().includes(q)) : clients;
  }, [clients, clientSearch]);

  const submit = async (e) => {
    e.preventDefault();
    if (!livreur) return setError('Sélectionnez un livreur');
    if (!destination) return setError("Cliquez sur la carte pour placer l'adresse de livraison");
    const price = form.delivery_price === '' ? 0 : Number(form.delivery_price);
    if (!Number.isInteger(price) || price < 0) return setError('Frais de livraison : nombre entier positif (FCFA)');
    setError(''); setLoading(true);
    try {
      const payload = { ...form, delivery_price: price, client_id: form.client_id ? Number(form.client_id) : undefined };
      if (linked) { delete payload.client_name; if (linked.phone) delete payload.client_phone; }
      const { data } = await api.post('/commercant/missions', {
        ...payload,
        livreur_id: livreur.id, client_lat: destination.lat, client_lng: destination.lng
      });
      setForm(EMPTY);
      onCreated?.(data);
    } catch (e) { setError(errMsg(e)); }
    finally { setLoading(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3 p-3">
      {/* Récapitulatif livreur + adresse */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="tk-detail-tile">
          <p className="tk-kpi-label flex items-center gap-1"><Bike size={12} /> Livreur</p>
          <p className="truncate text-sm font-semibold">{livreur ? `${livreur.name} (${livreur.distance_km ?? '?'} km)` : 'Choisir…'}</p>
        </div>
        <div className="tk-detail-tile">
          <p className="tk-kpi-label flex items-center gap-1"><MapPin size={12} /> Adresse</p>
          <p className="truncate text-sm font-semibold">{destination
            ? `${destination.lat.toFixed(5)}, ${destination.lng.toFixed(5)}`
            : <span style={{ color: '#b45309' }}>Cliquez sur la carte</span>}</p>
        </div>
      </div>

      {/* Client de la plateforme (facultatif) : la mission apparaîtra dans « Mes commandes » du client */}
      <div className="space-y-1">
        <span className="tk-label">Client de la plateforme (optionnel)</span>
        {clients.length > 8 && !linked && (
          <input className="input py-1.5 text-sm" placeholder="Rechercher un client…" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
        )}
        <select className="input" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
          <option value="">Choisir… (sinon saisie manuelle)</option>
          {filteredClients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.email}</option>)}
        </select>
      </div>

      {linked ? (
        <div className="tk-detail-tile flex items-start gap-2">
          <UserCheck size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--tk-accent-600)' }} />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">{linked.name}</p>
            <p className="text-gray-500">{linked.phone || 'Aucun téléphone enregistré'} · suivi de commande et notation activés</p>
            {!linked.phone && (
              <label className="mt-2 block space-y-1"><span className="tk-label">Téléphone du client</span>
                <input className="input" type="tel" placeholder="ex. 70 00 00 00" required value={form.client_phone} onChange={set('client_phone')} /></label>
            )}
          </div>
        </div>
      ) : (
        <>
          <label className="block space-y-1"><span className="tk-label">Nom du client</span>
            <input className="input" required value={form.client_name} onChange={set('client_name')} /></label>
          <label className="block space-y-1"><span className="tk-label">Téléphone du client</span>
            <input className="input" type="tel" placeholder="ex. 70 00 00 00" required value={form.client_phone} onChange={set('client_phone')} /></label>
        </>
      )}
      <label className="block space-y-1"><span className="tk-label">Détails de la commande</span>
        <textarea className="input" rows={3} maxLength={2000} placeholder="Articles, quantités, montant à encaisser…"
          value={form.order_details} onChange={set('order_details')} /></label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1"><span className="tk-label">Frais de livraison (FCFA)</span>
          <input className="input tk-num" type="number" min="0" step="25" inputMode="numeric" placeholder="ex. 1000"
            value={form.delivery_price} onChange={set('delivery_price')} /></label>
        <label className="block space-y-1"><span className="tk-label">Consignes</span>
          <input className="input" placeholder="Fragile, appeler avant…" value={form.description} onChange={set('description')} /></label>
      </div>

      {error && <p className="tk-alert tk-alert-danger">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={loading}><Send size={16} /> {loading ? 'Envoi…' : 'Envoyer la mission'}</button>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Annuler</button>}
      </div>
    </form>
  );
}
