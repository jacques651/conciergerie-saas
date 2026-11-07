// Panneau de messagerie privée temps réel avec un interlocuteur.
import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { getSocket } from '../socket';
import { useAuth } from '../auth.jsx';

/** props : peer {id, name}, onClose, title (optionnel) */
export default function ChatPanel({ peer, onClose, title }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef(null);

  // Historique + écoute des nouveaux messages
  useEffect(() => {
    if (!peer) return;
    let alive = true;
    api.get(`/messages/${peer.id}`).then(({ data }) => alive && setMessages(data)).catch(() => {});
    const s = getSocket();
    const onReceive = (m) => {
      const concerns = (m.from === peer.id && m.to === user.id) || (m.from === user.id && m.to === peer.id);
      if (concerns) setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    };
    s?.on('message:receive', onReceive);
    return () => { alive = false; s?.off('message:receive', onReceive); };
  }, [peer?.id, user.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = (e) => {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setError('');
    getSocket()?.emit('message:send', { to: peer.id, content }, (ack) => {
      if (ack?.error) return setError(ack.error);
      if (ack?.message) setMessages((prev) => (prev.some((x) => x.id === ack.message.id) ? prev : [...prev, ack.message]));
    });
    setText('');
  };

  if (!peer) return null;
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">💬 {title || peer.name}</p>
        </div>
        {onClose && <button onClick={onClose} className="text-xl leading-none text-gray-500" aria-label="Fermer">×</button>}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && <p className="text-center text-sm text-gray-400">Aucun message</p>}
        {messages.map((m) => {
          const mine = m.from === user.id;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${mine ? 'bg-brand text-white' : 'bg-gray-100'}`}>
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                <p className={`text-[10px] ${mine ? 'text-white/70' : 'text-gray-400'}`}>
                  {new Date(m.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {error && <p className="px-3 text-xs text-red-600">{error}</p>}
      <form onSubmit={send} className="flex gap-2 border-t p-2">
        <input className="input" placeholder="Votre message…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn-primary">Envoyer</button>
      </form>
    </div>
  );
}
