import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { errMsg } from '../api';
import { useAuth, homeFor } from '../auth.jsx';
import { ShieldCheck, User, Lock, Eye, EyeOff, LogIn } from 'lucide-react';
import AuthShell from '../components/AuthShell.jsx';

export default function Login() {
  const { saveSession } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { data } = await api.post('/auth/login', form);
      saveSession(data);
      // Non-admin sans abonnement actif → page de paiement
      if (data.role !== 'admin' && !data.subscription.active) nav('/abonnement');
      else nav(homeFor(data.role));
    } catch (e) { setError(errMsg(e)); }
    finally { setLoading(false); }
  };

  return (
    <AuthShell>
      <div className="text-center">
        <div className="tk-auth-brand"><ShieldCheck size={26} /> GESTIONLIVRAISON</div>
        <div className="tk-auth-bar mt-3" />
      </div>
      <h2>Connexion</h2>
      <p className="tk-auth-help">Veuillez entrer vos identifiants pour vous connecter</p>

      <form onSubmit={submit} className="space-y-4">
        {error && <p className="tk-alert tk-alert-danger">{error}</p>}
        <div className="tk-field">
          <input className="input" type="email" placeholder="Email" aria-label="Email" required autoComplete="email" autoFocus
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <User className="tk-right" />
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
