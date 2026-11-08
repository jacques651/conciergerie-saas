import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { errMsg } from '../api';
import { useAuth, homeFor } from '../auth.jsx';
import { ShieldCheck, Phone, Lock, Eye, EyeOff, LogIn, Clock, Ban, CheckCircle2 } from 'lucide-react';
import AuthShell from '../components/AuthShell.jsx';

export default function Login() {
  const { saveSession } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ phone: '', password: '' });
  const [params] = useSearchParams();
  // Message initial selon le contexte : ?compte=attente|refuse (compte bloqué), ?inscription=ok (après inscription)
  const initialNotice = params.get('compte') === 'refuse'
    ? { type: 'rejected', text: "Votre demande d'inscription a été refusée." }
    : params.get('compte') === 'attente'
      ? { type: 'pending', text: "Votre compte est en attente d'approbation par l'administrateur." }
      : null;
  const [notice, setNotice] = useState(initialNotice); // compte en attente / refusé (403)
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setNotice(null); setLoading(true);
    try {
      const { data } = await api.post('/auth/login', form);
      saveSession(data);
      // Non-admin sans abonnement actif → page de paiement
      if (data.role !== 'admin' && !data.subscription.active) nav('/abonnement');
      else nav(homeFor(data.role));
    } catch (e) {
      // 403 : compte non approuvé → message lisible du serveur, présenté comme une information
      const code = e?.response?.data?.code;
      if (e?.response?.status === 403 && code?.startsWith('ACCOUNT_')) {
        setNotice({ type: code === 'ACCOUNT_REJECTED' ? 'rejected' : 'pending', text: errMsg(e) });
      } else setError(errMsg(e));
    }
    finally { setLoading(false); }
  };

  return (
    <AuthShell>
      <div className="text-center">
        <div className="tk-auth-brand"><ShieldCheck size={26} /> GESTIONLIVRAISON</div>
        <div className="tk-auth-bar mt-3" />
      </div>
      <h2>Connexion</h2>
      <p className="tk-auth-help">Connectez-vous avec votre numéro de téléphone</p>

      <form onSubmit={submit} className="space-y-4">
        {notice && (
          <div className={`tk-alert flex items-start gap-2 ${notice.type === 'rejected' ? 'tk-alert-danger' : 'tk-alert-warning'}`} role="alert">
            {notice.type === 'rejected' ? <Ban size={18} className="mt-0.5 shrink-0" /> : <Clock size={18} className="mt-0.5 shrink-0" />}
            <div>
              <p className="font-semibold">{notice.text}</p>
              <p className="mt-0.5 text-xs opacity-90">
                {notice.type === 'rejected'
                  ? "Contactez l'administrateur pour plus d'informations."
                  : "Vous pourrez vous connecter dès que votre compte sera approuvé."}
              </p>
            </div>
          </div>
        )}
        {params.get('inscription') === 'ok' && !notice && !error && (
          <p className="tk-alert tk-alert-success flex items-center gap-2"><CheckCircle2 size={16} /> Compte créé : connexion possible après validation par l'administrateur.</p>
        )}
        {error && <p className="tk-alert tk-alert-danger">{error}</p>}
        <span className="tk-label block">Téléphone</span>
        <div className="tk-field">
          <input className="input tk-num" type="tel" inputMode="tel" placeholder="70 00 00 00" aria-label="Téléphone"
            required autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus
            value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Phone className="tk-left" />
        </div>
        <div className="tk-field">
          <Lock className="tk-left" />
          <input className="input" type={showPwd ? 'text' : 'password'} placeholder="Mot de passe" aria-label="Mot de passe" required autoComplete="current-password"
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <button type="button" className="tk-field-btn" onClick={() => setShowPwd((v) => !v)}
            aria-label={showPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
            {showPwd ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </div>
        <button className="btn-primary w-full" disabled={loading}>
          <LogIn size={18} /> {loading ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>

      <div className="tk-divider">OU</div>
      <p className="text-center text-sm" style={{ color: 'var(--tk-ink-2)' }}>
        Pas de compte ? <Link to="/register" className="font-semibold text-brand">Créer un compte</Link>
      </p>
      <p className="text-center text-sm" style={{ color: 'var(--tk-muted)' }}>
        Mot de passe oublié ? Contactez l'administrateur pour le réinitialiser.
      </p>
    </AuthShell>
  );
}
