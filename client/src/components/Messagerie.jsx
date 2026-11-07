// Messagerie complète réutilisable : liste des conversations + fenêtre de chat.
// - Desktop : 2 colonnes (liste | chat). Mobile : liste OU chat, avec bouton retour.
// - Historique via REST (/api/messages/...), envoi + réception temps réel via Socket.io.
//
// Props :
//   initialContact  { id, name, role? }  → ouvre directement cette conversation (même si aucun message encore)
//   onClose         () => void           → affiche un bouton de fermeture (usage en modale)
//   onUnreadChange  (n) => void          → nombre total de messages non lus (persistant, issu du serveur)
//   className       classes CSS additionnelles du conteneur
//   showHeader      false → masque l'en-tête « Messages » (ex. dans une modale qui a déjà son titre)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { errMsg } from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../auth.jsx';

const ROLE_LABEL = { client: 'Client', livreur: 'Livreur', commercant: 'Commerçant', admin: 'Admin' };
const ROLE_COLOR = { client: 'bg-blue-500', livreur: 'bg-brand', commercant: 'bg-green-600', admin: 'bg-gray-700' };

const initials = (name = '?') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

/** "14:32" aujourd'hui, "hier", sinon "12/11" */
function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'hier';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function Avatar({ name, role, size = 'h-10 w-10' }) {
  return (
    <span className={`${size} ${ROLE_COLOR[role] || 'bg-gray-400'} flex shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white`}>
      {initials(name)}
    </span>
  );
}

export default function Messagerie({ initialContact = null, onClose, onUnreadChange, className = '', showHeader = true }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [active, setActive] = useState(initialContact); // contact sélectionné
  const [messages, setMessages] = useState([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const endRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  // ---------- Liste des conversations ----------
  const loadConversations = useCallback(() =>
    api.get('/messages/conversations')
      .then(({ data }) => setConversations(data))
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoadingList(false)), []);
  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Ouverture demandée de l'extérieur (ex. clic sur un livreur)
  useEffect(() => { if (initialContact?.id) setActive(initialContact); }, [initialContact?.id]); // eslint-disable-line

  // ---------- Marquer une conversation comme lue (persistant en base) ----------
  const readTimers = useRef({}); // un minuteur par contact (regroupe les appels rapprochés)
  const markRead = useCallback((contactId) => {
    // Mise à jour optimiste du compteur local, puis persistance en base
    setConversations((prev) => prev.map((c) => (c.id === contactId ? { ...c, unread: 0 } : c)));
    clearTimeout(readTimers.current[contactId]);
    readTimers.current[contactId] = setTimeout(() => {
      api.post(`/messages/${contactId}/read`).catch(() => {});
    }, 300);
  }, []);
  useEffect(() => () => Object.values(readTimers.current).forEach(clearTimeout), []);

  // ---------- Historique de la conversation active ----------
  useEffect(() => {
    if (!active?.id) { setMessages([]); return; }
    let alive = true;
    setLoadingChat(true); setError('');
    api.get(`/messages/${active.id}`)
      .then(({ data }) => alive && setMessages(data))
      .catch((e) => alive && setError(errMsg(e)))
      .finally(() => alive && setLoadingChat(false));
    markRead(active.id);
    return () => { alive = false; };
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Temps réel ----------
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onReceive = (m) => {
      const mine = m.from === user.id;
      const contactId = mine ? m.to : m.from;
      const contact = mine
        ? { id: m.to, name: m.toName, role: m.toRole }
        : { id: m.from, name: m.fromName, role: m.fromRole };

      // 1) Conversation ouverte → ajout de la bulle (dédoublonnage par id)
      const isOpen = activeRef.current?.id === contactId;
      if (isOpen) {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        if (!mine) markRead(contactId); // conversation affichée → lu immédiatement
      }

      // 2) Liste : met à jour (ou crée) la conversation et la remonte en tête
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === contactId);
        const updated = {
          ...(existing || { ...contact, message_count: 0 }),
          name: existing?.name || contact.name || 'Contact',
          role: existing?.role || contact.role,
          last_message: m.content, last_from: m.from, last_at: m.timestamp, last_read_at: null,
          message_count: (existing?.message_count || 0) + 1,
          unread: !mine && !isOpen ? (existing?.unread || 0) + 1 : existing?.unread || 0
        };
        return [updated, ...prev.filter((c) => c.id !== contactId)];
      });
    };
    // Accusé de lecture : le contact a lu mes messages
    const onRead = ({ by, readAt }) => {
      if (activeRef.current?.id === by) {
        setMessages((prev) => prev.map((x) => (x.from === user.id && !x.read_at ? { ...x, read_at: readAt } : x)));
      }
      setConversations((prev) => prev.map((c) => (c.id === by && c.last_from === user.id ? { ...c, last_read_at: readAt } : c)));
    };
    // Conversation lue depuis un autre onglet / appareil → remise à zéro locale
    const onUnreadSync = ({ contactId }) => {
      if (contactId) setConversations((prev) => prev.map((c) => (c.id === contactId ? { ...c, unread: 0 } : c)));
    };
    s.on('message:receive', onReceive);
    s.on('message:read', onRead);
    s.on('message:unread-count', onUnreadSync);
    return () => { s.off('message:receive', onReceive); s.off('message:read', onRead); s.off('message:unread-count', onUnreadSync); };
  }, [user.id, markRead]);

  // Badge externe
  const totalUnread = useMemo(() => conversations.reduce((a, c) => a + (c.unread || 0), 0), [conversations]);
  useEffect(() => { onUnreadChange?.(totalUnread); }, [totalUnread]); // eslint-disable-line

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ---------- Envoi ----------
  const send = (e) => {
    e.preventDefault();
    const content = text.trim();
    if (!content || !active) return;
    setError('');
    const s = getSocket();
    if (!s?.connected) return setError('Connexion temps réel indisponible, réessayez dans un instant.');
    s.emit('message:send', { to: active.id, content }, (ack) => {
      if (ack?.error) { setError(ack.error); setText(content); }
      // Le message revient aussi via "message:receive" ; l'ack sert de filet de sécurité
      else if (ack?.message) setMessages((prev) => (prev.some((x) => x.id === ack.message.id) ? prev : [...prev, ack.message]));
    });
    setText('');
  };

  // Le contact actif peut ne pas encore figurer dans la liste (nouvelle conversation)
  const list = useMemo(() => {
    const base = active && !conversations.some((c) => c.id === active.id)
      ? [{ ...active, last_message: null, last_at: null }, ...conversations]
      : conversations;
    const q = search.trim().toLowerCase();
    return q ? base.filter((c) => c.name?.toLowerCase().includes(q)) : base;
  }, [conversations, active, search]);

  const activeInfo = active && (conversations.find((c) => c.id === active.id) || active);

  // Regroupement des bulles par jour
  const grouped = useMemo(() => {
    const out = []; let lastDay = '';
    for (const m of messages) {
      const day = new Date(m.timestamp).toDateString();
      if (day !== lastDay) { out.push({ sep: true, key: `d${day}`, label: new Date(m.timestamp).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }); lastDay = day; }
      out.push(m);
    }
    return out;
  }, [messages]);

  return (
    <div className={`flex h-full min-h-0 overflow-hidden bg-white ${className}`}>
      {/* ============ Colonne gauche : conversations ============ */}
      <aside className={`${active ? 'hidden md:flex' : 'flex'} w-full min-h-0 flex-col border-r md:w-72 lg:w-80`}>
        {showHeader && (
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <h2 className="tk-card-title font-semibold">Messages</h2>
            {onClose && <button onClick={onClose} className="text-2xl leading-none text-gray-500 hover:text-gray-800" aria-label="Fermer">×</button>}
          </div>
        )}
        <div className="border-b p-2">
          <input className="input py-1.5 text-sm" placeholder="Rechercher un contact…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <ul className="flex-1 overflow-y-auto">
          {loadingList && <li className="p-4 text-center text-sm text-gray-400">Chargement…</li>}
          {!loadingList && list.length === 0 && (
            <li className="p-6 text-center text-sm text-gray-500">Aucune conversation pour l'instant.</li>
          )}
          {list.map((c) => {
            const n = c.unread || 0;
            return (
              <li key={c.id}>
                <button onClick={() => setActive({ id: c.id, name: c.name, role: c.role })}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 ${active?.id === c.id ? 'bg-brand-light' : ''}`}>
                  <Avatar name={c.name} role={c.role} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={`truncate ${n ? 'font-bold' : 'font-medium'}`}>{c.name}</span>
                      <span className="shrink-0 text-[11px] text-gray-400">{shortDate(c.last_at)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-xs ${n ? 'font-semibold text-gray-800' : 'text-gray-500'}`}>
                        {c.last_message == null ? <i>Nouvelle conversation</i> : <>{c.last_from === user.id && <span className={c.last_read_at ? 'text-blue-500' : ''}>{c.last_read_at ? '✓✓ ' : '✓ '}</span>}{c.last_from === user.id && 'Vous : '}{c.last_message}</>}
                      </span>
                      {n > 0 && <span className="shrink-0 rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{n}</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* ============ Colonne droite : chat actif ============ */}
      <section className={`${active ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-1 flex-col`}>
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-gray-400">
            <span className="text-5xl">💬</span>
            <p className="text-sm">Sélectionnez une conversation</p>
            {onClose && <button onClick={onClose} className="btn-ghost mt-2 text-sm">Fermer</button>}
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2 border-b px-2 py-2">
              <button onClick={() => setActive(null)} className="rounded p-1 text-xl text-gray-600 hover:bg-gray-100 md:hidden" aria-label="Retour">←</button>
              <Avatar name={activeInfo.name} role={activeInfo.role} size="h-9 w-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold leading-tight">{activeInfo.name}</p>
                {activeInfo.role && <p className="text-xs text-gray-500">{ROLE_LABEL[activeInfo.role] || activeInfo.role}</p>}
              </div>
              {onClose && <button onClick={onClose} className="px-2 text-2xl leading-none text-gray-500 hover:text-gray-800" aria-label="Fermer">×</button>}
            </header>

            <div className="flex-1 space-y-1.5 overflow-y-auto bg-gray-50 p-3">
              {loadingChat && <p className="text-center text-sm text-gray-400">Chargement…</p>}
              {!loadingChat && messages.length === 0 && (
                <p className="mt-8 text-center text-sm text-gray-400">Aucun message. Écrivez le premier !</p>
              )}
              {grouped.map((m) => m.sep ? (
                <p key={m.key} className="py-2 text-center text-[11px] uppercase tracking-wide text-gray-400">{m.label}</p>
              ) : (
                <div key={m.id} className={`flex ${m.from === user.id ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm shadow-sm ${m.from === user.id ? 'rounded-br-sm bg-brand text-white' : 'rounded-bl-sm bg-white text-gray-800'}`}>
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    <p className={`text-right text-[10px] ${m.from === user.id ? 'text-white/70' : 'text-gray-400'}`}>
                      {new Date(m.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      {m.from === user.id && (
                        <span className={`ml-1 font-semibold ${m.read_at ? 'text-sky-200' : ''}`} title={m.read_at ? `Lu le ${new Date(m.read_at).toLocaleString('fr-FR')}` : 'Envoyé'}>
                          {m.read_at ? '✓✓' : '✓'}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              ))}
              {(() => {
                const lastMine = [...messages].reverse().find((x) => x.from === user.id);
                return lastMine?.read_at && messages[messages.length - 1]?.id === lastMine.id ? (
                  <p className="pr-1 text-right text-[11px] text-gray-400">Vu {shortDate(lastMine.read_at)}</p>
                ) : null;
              })()}
              <div ref={endRef} />
            </div>

            {error && <p className="tk-alert tk-alert-danger mx-2 mb-1 py-1 text-xs">{error}</p>}
            <form onSubmit={send} className="flex gap-2 border-t bg-white p-2">
              <input className="input" placeholder="Votre message…" value={text} maxLength={2000}
                onChange={(e) => setText(e.target.value)} autoComplete="off" />
              <button className="btn-primary shrink-0" disabled={!text.trim()}>Envoyer</button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
