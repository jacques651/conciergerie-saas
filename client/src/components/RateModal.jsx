// Notation d'un livreur après une mission livrée (commerçant ou client destinataire).
// POST /api/missions/:id/review, confirmation par notification (Toast).
import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import api, { errMsg } from '../api';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';

/** Affichage en lecture seule : n étoiles pleines sur 5 */
export function Stars({ value, size = 14 }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} sur 5`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={size} className={n <= value ? 'tk-star-on' : 'text-gray-300'} fill={n <= value ? 'currentColor' : 'none'} />)}
    </span>
  );
}


/** Fenêtre de notation : 5 étoiles cliquables + commentaire */
export default function RateModal({ mission, onClose, onDone }) {
  const { toast } = useToast();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setRating(0); setHover(0); setComment(''); setError(''); }, [mission?.id]);
  const LABELS = ['', 'Très décevant', 'Décevant', 'Correct', 'Bien', 'Excellent'];

  const submit = async (e) => {
    e.preventDefault();
    if (rating < 1 || rating > 5) return setError('Choisissez une note de 1 à 5 étoiles.');
    setSending(true); setError('');
    try {
      const { data } = await api.post(`/missions/${mission.id}/review`, { rating, comment: comment.trim() || undefined });
      toast({ type: 'success', title: 'Merci pour votre avis !', body: `${mission.livreur_name} : ${rating}/5 · moyenne ${String(data.average).replace('.', ',')}/5` });
      onDone(mission.id, rating);
    } catch (err) {
      setError(errMsg(err));
      toast({ type: 'danger', title: "Note non envoyée", body: errMsg(err) });
    } finally { setSending(false); }
  };

  const shown = hover || rating;
  return (
    <Modal open={!!mission} onClose={onClose} title="Noter le livreur" icon={Star} width={440}>
      {mission && (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--tk-ink-2)' }}>
            Mission <b>#{mission.id}</b> · livrée à {mission.client_name} par <b>{mission.livreur_name}</b>
          </p>
          <div className="flex flex-col items-center gap-1">
            <div className="tk-stars" role="radiogroup" aria-label="Note sur 5" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
                  className={n <= shown ? 'is-on' : ''} onMouseEnter={() => setHover(n)} onClick={() => setRating(n)}>
                  <Star size={34} fill={n <= shown ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
            <p className="h-5 text-sm font-semibold" style={{ color: 'var(--tk-ink-2)' }}>{LABELS[shown]}</p>
          </div>
          <label className="block space-y-1">
            <span className="tk-label">Commentaire (facultatif)</span>
            <textarea className="input" rows={3} maxLength={1000} placeholder="Ponctualité, amabilité, état du colis…"
              value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          {error && <p className="tk-alert tk-alert-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Annuler</button>
            <button className="btn-primary" disabled={sending || rating === 0}>{sending ? 'Envoi…' : 'Envoyer ma note'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

