// Espace livreur — mobile-first.
// Desktop : carte 60 % | missions 40 %. Mobile : carte 50vh en haut, missions en dessous.
// GPS : watchPosition + envoi socket "livreur:location" toutes les 5 s quand en ligne / en livraison.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { errMsg } from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../auth.jsx';
import AppLayout from '../components/AppLayout.jsx';
import { TriangleAlert, Wallet, PackageCheck, Coins, Star } from 'lucide-react';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import MapView, { ICONS } from '../components/MapView.jsx';
import Messagerie from '../components/Messagerie.jsx';
import { useUnreadMessages } from '../hooks';

const SEND_INTERVAL = 5000; // ms entre deux envois de position
const STATUS_LABEL = { pending: 'Nouvelle', accepted: 'Acceptée', refused: 'Refusée', en_cours: 'En cours', livree: 'Terminée', annulee: 'Annulée' };
const fcfa = (n) => `${Number(n || 0).toLocaleString('fr-FR')} FCFA`;
const STATUS_COLOR = {
  pending: 'bg-amber-100 text-amber-800', accepted: 'bg-blue-100 text-blue-800', en_cours: 'bg-purple-100 text-purple-800',
  livree: 'bg-green-100 text-green-800', refused: 'bg-gray-200 text-gray-600', annulee: 'bg-gray-200 text-gray-600'
};

/** Message lisible selon l'erreur de géolocalisation */
function gpsErrorMessage(err) {
  if (!window.isSecureContext) return 'GPS bloqué : la page doit être ouverte en HTTPS (https://…). Le navigateur refuse la localisation sur une adresse non sécurisée.';
  if (!navigator.geolocation) return "GPS indisponible : ce navigateur ne supporte pas la géolocalisation.";
  if (err?.code === 1) return "GPS bloqué : autorisez l'accès à la position dans les paramètres du navigateur (icône 🔒 à gauche de l'adresse).";
  if (err?.code === 2) return 'Position introuvable : activez la localisation (GPS) de votre appareil.';
  if (err?.code === 3) return 'Délai GPS dépassé : nouvelle tentative en cours…';
  return 'Erreur GPS inconnue.';
}

export default function DashboardLivreur() {
  const { user, subscription } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState(null);
  const [missions, setMissions] = useState([]);
  const [shared, setShared] = useState([]); // positions partagées par les clients
  const [contact, setContact] = useState(null); // conversation à ouvrir dans l'onglet Messages
  const [tab, setTab] = useState('missions');
  const [error, setError] = useState('');
  const [gpsError, setGpsError] = useState(window.isSecureContext ? '' : gpsErrorMessage());
  const [lastSentAt, setLastSentAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const unread = useUnreadMessages(user.id, tab === 'messages');
  // Ouvre l'onglet Messages sur un contact donné
  const openChat = (c) => { setContact(c); setTab('messages'); };
  // Lien de notification « ?chat=ID&nom=… » → ouvre directement la conversation, puis nettoie l'URL
  const [chatParams, setChatParams] = useSearchParams();
  useEffect(() => {
    const id = Number(chatParams.get('chat'));
    if (!id) return;
    openChat({ id, name: chatParams.get('nom') || 'Contact' });
    setChatParams({}, { replace: true });
  }, [chatParams]); // eslint-disable-line react-hooks/exhaustive-deps


  const watchIdRef = useRef(null);
  const posRef = useRef(null); // dernière position GPS connue

  const status = profile?.status;
  const pending = status === 'pending_approval';
  const online = status === 'en_ligne' || status === 'en_livraison';
  const delivering = status === 'en_livraison';
  const subActive = !!subscription?.active && Date.parse(subscription?.expires_at || 0) > Date.now();

  // ---------- Chargement ----------
  const loadProfile = useCallback(() => api.get('/livreur/me').then((r) => setProfile(r.data)).catch(() => {}), []);
  const loadMissions = useCallback(() => api.get('/livreur/missions').then((r) => setMissions(r.data)).catch(() => {}), []);

  // ---------- Gains (GET /api/livreur/stats) ----------
  const [stats, setStats] = useState({ today_earnings: 0, today_count: 0, total_earnings: 0, completed_count: 0 });
  const loadStats = useCallback(() => api.get('/livreur/stats').then((r) => setStats(r.data)).catch(() => {}), []);

  // ---------- Historique (GET /api/livreur/historique) ----------
  const [history, setHistory] = useState({ missions: [], stats: { count: 0, earnings: 0 } });
  const [histLoading, setHistLoading] = useState(false);
  const loadHistory = useCallback(() => {
    setHistLoading(true);
    return api.get('/livreur/historique').then((r) => setHistory(r.data)).catch(() => {}).finally(() => setHistLoading(false));
  }, []);

  // ---------- Note moyenne (GET /api/users/:id/reviews) ----------
  const [reviews, setReviews] = useState({ average: null, count: 0, latest: [] });
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const loadReviews = useCallback(() => api.get(`/users/${user.id}/reviews`, { params: { limit: 10 } })
    .then((r) => setReviews(r.data)).catch(() => {}), [user.id]);
  useEffect(() => { loadReviews(); }, [loadReviews]);
  useEffect(() => {
    const s = getSocket();
    const onReview = ({ review }) => {
      loadReviews();
      toast({ type: 'success', title: `Nouvelle note : ${review.rating}/5`, body: review.comment || 'Un commerçant a noté votre livraison.' });
    };
    s?.on('review:new', onReview);
    return () => s?.off('review:new', onReview);
  }, [loadReviews]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (profile && !pending && subActive) loadStats(); }, [profile?.status, subActive]); // eslint-disable-line
  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => { if (profile && !pending && subActive) loadMissions(); }, [status, subActive]); // eslint-disable-line

  // ---------- Événements temps réel ----------
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onNew = ({ mission }) => {
      setMissions((p) => [mission, ...p.filter((m) => m.id !== mission.id)]);
      setTab('missions');
      navigator.vibrate?.([200, 100, 200]);
    };
    const onUpd = ({ missionId, status: st }) => setMissions((p) => p.map((m) => (m.id === missionId ? { ...m, status: st } : m)));
    // (les gains sont rechargés après chaque livraison terminée, cf. completeMission)
    const onShared = (d) => setShared((p) => [{ ...d, at: Date.now() }, ...p.filter((x) => x.clientId !== d.clientId)].slice(0, 10));
    s.on('mission:new', onNew);
    s.on('mission:status-update', onUpd);
    s.on('client:position-shared', onShared);
    s.on('livreur:approved', loadProfile);
    return () => {
      s.off('mission:new', onNew); s.off('mission:status-update', onUpd);
      s.off('client:position-shared', onShared); s.off('livreur:approved', loadProfile);
    };
  }, [loadProfile]);

  // ---------- GPS : suivi continu (watchPosition) ----------
  useEffect(() => {
    if (pending || !navigator.geolocation || !window.isSecureContext) return;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (p) => {
        posRef.current = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
        setProfile((pr) => (pr ? { ...pr, lat: posRef.current.lat, lng: posRef.current.lng } : pr));
        setGpsError('');
      },
      (err) => setGpsError(gpsErrorMessage(err)),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
    return () => { if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current); };
  }, [pending]);

  // ---------- Envoi socket toutes les 5 s quand en ligne / en livraison ----------
  useEffect(() => {
    if (!online || !subActive) return;
    const send = () => {
      if (!posRef.current) return;
      getSocket()?.emit('livreur:location', { lat: posRef.current.lat, lng: posRef.current.lng });
      setLastSentAt(new Date());
    };
    send(); // envoi immédiat au passage en ligne
    const t = setInterval(send, SEND_INTERVAL);
    return () => clearInterval(t);
  }, [online, subActive]);

  // ---------- Actions ----------
  const setStatus = async (next) => {
    setError(''); setBusy(true);
    try { const { data } = await api.put('/livreur/status', { status: next }); setProfile((p) => ({ ...p, ...data })); }
    catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };

  const toggleOnline = () => setStatus(online ? 'hors_ligne' : 'en_ligne');

  // Démarrer / terminer la livraison : utilise la mission acceptée si elle existe
  const toggleDelivery = async () => {
    const accepted = missions.find((m) => m.status === 'accepted');
    const current = missions.find((m) => m.status === 'en_cours');
    if (!delivering) return accepted ? missionAction(accepted, 'start') : setStatus('en_livraison');
    return current ? completeMission(current) : setStatus('en_ligne');
  };

  // Terminer une livraison : événement socket "mission:completed" (repli REST si la connexion temps réel est coupée)
  const completeMission = (m) => {
    setError(''); setBusy(true);
    const done = (mission) => {
      setMissions((p) => p.map((x) => (x.id === m.id ? { ...x, ...mission } : x)));
      setProfile((p) => ({ ...p, status: 'en_ligne' }));
      loadStats();
      loadHistory();
      setBusy(false);
    };
    const s = getSocket();
    if (!s?.connected) {
      return api.post(`/livreur/missions/${m.id}/complete`).then((r) => done(r.data))
        .catch((e) => { setError(errMsg(e)); setBusy(false); });
    }
    s.timeout(8000).emit('mission:completed', { missionId: m.id }, (err, ack) => {
      if (err) { setError('Pas de réponse du serveur, réessayez.'); return setBusy(false); }
      if (ack?.error) { setError(ack.error); return setBusy(false); }
      done(ack.mission);
    });
  };

  const missionAction = async (m, action) => {
    setError(''); setBusy(true);
    try {
      const { data } = await api.post(`/livreur/missions/${m.id}/${action}`);
      setMissions((p) => p.map((x) => (x.id === m.id ? { ...x, ...data } : x)));
      if (action === 'start') setProfile((p) => ({ ...p, status: 'en_livraison' }));
      if (action === 'complete') setProfile((p) => ({ ...p, status: 'en_ligne' }));
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };

  // ---------- Compte en attente : page bloquée ----------
  if (pending) {
    return (
      <AppLayout title="Espace livreur">
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="card max-w-sm p-6 text-center">
            <div className="text-5xl">⏳</div>
            <h2 className="mt-2 text-lg font-bold">Compte en attente de validation</h2>
            <p className="mt-2 text-sm text-gray-600">Un administrateur doit approuver votre inscription avant que vous puissiez vous mettre en ligne. Cette page se met à jour automatiquement.</p>
            <button className="btn-ghost mt-4" onClick={loadProfile}>Actualiser</button>
          </div>
        </div>
      </AppLayout>
    );
  }

  // ---------- Données carte ----------
  const me = profile?.lat != null
    ? { lat: profile.lat, lng: profile.lng, icon: delivering ? ICONS.livraison : ICONS.livreur, label: 'Ma position', track: delivering }
    : null;
  const extra = [
    ...shared.filter((s) => s.clientLat != null)
      .map((s) => ({ id: `c${s.clientId}`, lat: s.clientLat, lng: s.clientLng, icon: ICONS.me, label: `Client : ${s.clientName}` })),
    ...missions.filter((m) => ['pending', 'accepted', 'en_cours'].includes(m.status) && m.client_lat != null)
      .map((m) => ({ id: `m${m.id}`, lat: m.client_lat, lng: m.client_lng, icon: ICONS.dest, label: `Mission #${m.id} – ${m.client_name}` }))
  ];
  const pendingCount = missions.filter((m) => m.status === 'pending').length;
  // Onglet Missions : missions à traiter ; les livrées sont dans l'onglet Historique
  const activeMissions = missions.filter((m) => ['pending', 'accepted', 'en_cours'].includes(m.status));

  return (
    <AppLayout title="Espace livreur" fill
      actions={<>
        <span className="tk-chip" title={`${stats.today_count} course(s) aujourd'hui`}><Wallet size={14} /> Gains du jour : {fcfa(stats.today_earnings)}</span>
        <button className="tk-chip" onClick={() => setReviewsOpen(true)} title="Voir mes avis">
          ⭐ {reviews.average != null ? `${String(reviews.average).replace('.', ',')}/5 (${reviews.count})` : 'Pas encore noté'}
        </button>
        <span className="tk-chip">{delivering ? 'En livraison' : online ? 'En ligne' : 'Hors ligne'}</span>
      </>}>
      {/* Bandeau d'alerte GPS (rouge plein, bien visible) */}
      {gpsError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl px-3 py-2 text-sm text-white" style={{ background: 'var(--tk-danger)' }}>
          <TriangleAlert size={18} className="mt-0.5 shrink-0" /><span className="flex-1">{gpsError}</span>
        </div>
      )}
      {error && (
        <div className="tk-alert tk-alert-danger flex items-center justify-between">
          <span>{error}</span><button onClick={() => setError('')} className="font-bold" aria-label="Fermer">×</button>
        </div>
      )}

      <div className="tk-fill flex flex-col md:flex-row">
        {/* ===== Carte (moitié haute sur mobile / 60 % sur desktop) ===== */}
        <section className="tk-map-overlay relative h-1/2 shrink-0 md:h-auto md:w-3/5">
          <MapView center={me} me={me} extraMarkers={extra} recenter zoom={15} />

          {/* Barre d'état superposée */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] p-2">
            <div className="pointer-events-auto mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl border bg-white/95 p-2 shadow-lg">
              <span className="flex items-center gap-1.5 px-1 text-sm font-medium">
                <span className={`h-2.5 w-2.5 rounded-full ${delivering ? 'animate-pulse bg-red-500' : online ? 'bg-green-500' : 'bg-gray-400'}`} />
                {delivering ? 'En livraison' : online ? 'En ligne' : 'Hors ligne'}
              </span>

              <button onClick={toggleOnline} disabled={busy || !subActive || delivering}
                title={!subActive ? 'Abonnement expiré' : delivering ? 'Terminez la livraison d\'abord' : ''}
                className={`flex-1 py-1.5 text-sm ${online ? 'btn-ghost' : 'btn-primary'}`}>
                {online ? 'Passer hors ligne' : 'Se mettre en ligne'}
              </button>

              <button onClick={toggleDelivery} disabled={busy || !subActive || !online}
                className={`flex-1 py-1.5 text-sm ${delivering ? 'btn-danger' : 'btn-primary'}`}>
                {delivering ? '■ Terminer la livraison' : '▶ Démarrer la livraison'}
              </button>
            </div>
            {!subActive && (
              <p className="pointer-events-auto mx-auto mt-1 max-w-xl rounded-lg px-2 py-1 text-center text-xs text-white" style={{ background: 'var(--tk-danger)' }}>
                Abonnement expiré : impossible de se mettre en ligne.
              </p>
            )}
          </div>

          {/* Indicateur d'envoi GPS */}
          {online && (
            <div className="absolute bottom-2 left-2 z-[500] rounded-full bg-black/70 px-3 py-1 text-xs text-white">
              {posRef.current ? `📡 Position envoyée ${lastSentAt ? lastSentAt.toLocaleTimeString('fr-FR') : '…'} · ±${Math.round(posRef.current.accuracy || 0)} m` : '📡 Recherche du signal GPS…'}
            </div>
          )}
        </section>

        {/* ===== Missions / clients (40 % desktop) ===== */}
        <aside className="flex min-h-0 flex-1 flex-col border-t bg-gray-50 md:w-2/5 md:flex-none md:border-l md:border-t-0">
          {/* Widget gains */}
          <div className="grid grid-cols-3 gap-2 border-b bg-white p-2">
            {[
              [Coins, 'Gains du jour', fcfa(stats.today_earnings)],
              [PackageCheck, 'Courses du jour', stats.today_count],
              [Wallet, 'Total gagné', fcfa(stats.total_earnings)]
            ].map(([Icon, label, value]) => (
              <div key={label} className="tk-kpi !block !p-2">
                <p className="tk-kpi-label flex items-center gap-1 !text-[9.5px]"><Icon size={12} className="shrink-0" /> <span className="truncate">{label}</span></p>
                <p className="tk-kpi-value !text-[14px]">{value}</p>
              </div>
            ))}
          </div>
          <div className="border-b bg-white p-2">
           <div className="tk-pills tk-pills-block tk-pills-compact" role="tablist">
            {[['missions', 'Missions', pendingCount], ['clients', 'Clients', shared.length], ['historique', 'Historique', 0], ['messages', 'Messages', unread]].map(([k, label, n]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); if (k === 'messages') setContact(null); if (k === 'historique') loadHistory(); }}>
                {label}
                {n > 0 && <span className="tk-count">{n}</span>}
              </button>
            ))}
           </div>
          </div>

          {tab === 'messages' ? (
            <div className="min-h-[60vh] flex-1 md:min-h-0"><Messagerie initialContact={contact} /></div>
          ) : tab === 'historique' ? (
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="tk-kpi !block !p-2"><p className="tk-kpi-label">Livraisons terminées</p><p className="tk-kpi-value !text-[15px]">{history.stats.count}</p></div>
                <div className="tk-kpi !block !p-2"><p className="tk-kpi-label">Total gagné</p><p className="tk-kpi-value !text-[15px]">{fcfa(history.stats.earnings)}</p></div>
              </div>
              {histLoading && <p className="p-4 text-center text-sm text-gray-400">Chargement…</p>}
              {!histLoading && history.missions.length === 0 && <p className="p-6 text-center text-sm text-gray-500">Aucune livraison terminée pour le moment.</p>}
              <ul className="space-y-2">
                {history.missions.map((m) => (
                  <li key={m.id} className="card space-y-1.5 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <b className="truncate">#{m.id} · {m.commercant_name}</b>
                      <span className="tk-money shrink-0">{fcfa(m.delivery_price)}</span>
                    </div>
                    <p className="text-gray-600">👤 {m.client_name} · livrée le {m.completed_at ? new Date(m.completed_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '·'}</p>
                    {m.order_details && <p className="tk-detail-tile whitespace-pre-wrap text-xs">{m.order_details}</p>}
                    {m.reviews?.length > 0 ? (
                      <div className="space-y-1">
                        {m.reviews.map((r, i) => (
                          <p key={i} className="text-xs" style={{ color: 'var(--tk-ink-2)' }}>
                            <span className="tk-star-on">{'★'.repeat(r.rating)}</span><span className="text-gray-300">{'★'.repeat(5 - r.rating)}</span>
                            {' '}<b>{r.reviewer_name}</b> ({r.reviewer_role === 'client' ? 'client' : 'commerçant'}){r.comment ? ` : « ${r.comment} »` : ''}
                          </p>
                        ))}
                      </div>
                    ) : <p className="text-xs text-gray-400">Pas encore noté</p>}
                  </li>
                ))}
              </ul>
            </div>
          ) : tab === 'missions' ? (
            <ul className="flex-1 space-y-2 overflow-y-auto p-2">
              {activeMissions.length === 0 && <p className="p-6 text-center text-sm text-gray-500">Aucune mission en cours.{!online && ' Mettez-vous en ligne pour en recevoir.'}</p>}
              {activeMissions.map((m) => (
                <li key={m.id} className={`card space-y-1.5 p-3 text-sm ${m.status === 'pending' ? 'ring-2 ring-amber-400' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <b className="truncate">#{m.id} · {m.commercant_name || 'Commerçant'}</b>
                    <span className={`badge shrink-0 ${STATUS_COLOR[m.status] || ''}`}>{STATUS_LABEL[m.status] || m.status}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0">👤 <b>{m.client_name}</b> · <span className="tk-num">{m.client_phone}</span></p>
                    <a className="btn-ghost shrink-0 px-3 py-1 text-xs" href={`tel:${m.client_phone.replace(/\s+/g, '')}`} aria-label={`Appeler ${m.client_name}`}>
                      📞 Appeler
                    </a>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5" style={{ background: 'var(--tk-accent-50)' }}>
                    <span className="tk-kpi-label">Prix de la course</span>
                    <span className="tk-money">{m.delivery_price > 0 ? fcfa(m.delivery_price) : 'Non renseigné'}</span>
                  </div>
                  {m.order_details && (
                    <div className="tk-detail-tile">
                      <p className="tk-kpi-label">Détails de la commande</p>
                      <p className="whitespace-pre-wrap text-sm">{m.order_details}</p>
                    </div>
                  )}
                  {m.description && <p className="text-gray-600">Consignes : {m.description}</p>}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {m.status === 'pending' && <>
                      <button disabled={busy} className="btn-success py-2" onClick={() => missionAction(m, 'accept')}>✓ Accepter</button>
                      <button disabled={busy} className="btn-danger py-2" onClick={() => missionAction(m, 'refuse')}>✕ Refuser</button>
                    </>}
                    {m.status === 'accepted' && <button disabled={busy} className="btn-primary col-span-2 py-2" onClick={() => missionAction(m, 'start')}>▶ Démarrer cette livraison</button>}
                    {m.status === 'en_cours' && <button disabled={busy} className="btn-success col-span-2 py-2" onClick={() => completeMission(m)}>✓ Terminer la livraison</button>}
                    {m.client_lat != null && ['accepted', 'en_cours'].includes(m.status) && (
                      <a className="btn-ghost py-2" target="_blank" rel="noreferrer"
                        href={`https://www.openstreetmap.org/directions?to=${m.client_lat},${m.client_lng}`}>🧭 Itinéraire</a>
                    )}
                    <button className="btn-ghost py-2" onClick={() => openChat({ id: m.commercant_id, name: m.commercant_name || 'Commerçant', role: 'commercant' })}>💬 Commerçant</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="flex-1 divide-y overflow-y-auto bg-white">
              {shared.length === 0 && <p className="p-6 text-center text-sm text-gray-500">Les clients qui vous sollicitent apparaîtront ici.</p>}
              {shared.map((s) => (
                <li key={s.clientId} className="flex items-center justify-between gap-2 p-3 text-sm">
                  <span className="min-w-0 truncate">📍 <b>{s.clientName}</b> <span className="text-xs text-gray-400">{new Date(s.at).toLocaleTimeString('fr-FR')}</span></span>
                  <button className="btn-ghost shrink-0 px-3 py-1" onClick={() => openChat({ id: s.clientId, name: s.clientName, role: 'client' })}>💬 Discuter</button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
      {/* Mes avis : moyenne + derniers commentaires */}
      <Modal open={reviewsOpen} onClose={() => setReviewsOpen(false)} title="Mes avis" icon={Star} width={480}>
        <div className="space-y-3">
          <div className="tk-kpi">
            <span className="tk-kpi-icon"><Star size={18} /></span>
            <div><p className="tk-kpi-label">Note moyenne</p>
              <p className="tk-kpi-value">{reviews.average != null ? `${String(reviews.average).replace('.', ',')}/5` : '·'} <span className="text-sm font-medium text-gray-500">sur {reviews.count} avis</span></p></div>
          </div>
          {reviews.latest.length === 0 && <p className="text-center text-sm text-gray-500">Aucun avis pour le moment.</p>}
          <ul className="space-y-2">
            {reviews.latest.map((r) => (
              <li key={r.id} className="tk-detail-tile">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{r.reviewer_name} · mission #{r.mission_id}</span>
                  <span className="tk-star-on text-sm" aria-label={`${r.rating} sur 5`}>{'★'.repeat(r.rating)}<span className="text-gray-300">{'★'.repeat(5 - r.rating)}</span></span>
                </div>
                {r.comment && <p className="mt-1 text-sm" style={{ color: 'var(--tk-ink-2)' }}>{r.comment}</p>}
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </AppLayout>
  );
}
