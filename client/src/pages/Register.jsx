// Inscription simplifiée (usage terrain) : un seul formulaire, sans email.
// Champs : nom complet, téléphone, mot de passe (4 caractères min.) + choix du profil.
// POST /api/auth/register { name, phone, password, role } → compte "en attente" de validation par l'admin.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserRound, Store, Bike, Phone, Lock, Eye, EyeOff, UserPlus, CheckCircle2, LogIn } from 'lucide-react';
import api, { errMsg } from '../api';
import AuthShell from '../components/AuthShell.jsx';
import { normalizePhone, formatPhone, PHONE_HINT } from '../phone';

const ROLES = [
  { v: 'client', label: 'Client', icon: UserRound },
  { v: 'commercant', label: 'Commerçant', icon: Store },
  { v: 'livreur', label: 'Livreur', icon: Bike }
];

export default function Register() {
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', phone: '', password: '', role: 'client' });
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(null); // compte créé, en attente de validation
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    // Vérifications locales (le serveur revérifie tout)
    if (!form.name.trim()) return setError('Indiquez votre nom complet.');
    const phone = normalizePhone(form.phone);
    if (!phone) return setError(`Numéro de téléphone invalide : ${PHONE_HINT} (ex : 70 12 34 56).`);
    if (form.password.length < 4) return setError('Le mot de passe doit contenir au moins 4 caractères.');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', { name: form.name.trim(), phone, password: form.password, role: form.role });
      setCreated(data.user);
    } catch (err) { setError(errMsg(err)); }
    finally { setLoading(false); }
  };

  // ---------- Confirmation ----------
  if (created) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: 'var(--tk-accent-50)', color: 'var(--tk-accent-700)' }}>
            <CheckCircle2 size={30} />
          </span>
          <h2>Inscription réussie</h2>
        </div>
        <p className="tk-alert tk-alert-success text-center" role="status">
          Votre compte a été créé avec succès. Il est en attente de validation par l'administrateur.
          Une fois validé, vous pourrez vous connecter.
        </p>
        <p className="text-center text-sm" style={{ color: 'var(--tk-ink-2)' }}>
          Votre identifiant : <b className="tk-num">{formatPhone(created.phone)}</b>
        </p>
        <button className="btn-primary w-full" onClick={() => nav('/login')}>
          <LogIn size={18} /> Aller à la page de connexion
        </button>
      </AuthShell>
    );
  }

  // ---------- Formulaire unique ----------
  return (
    <AuthShell>
      <h2>Créer un compte</h2>
      <p className="tk-auth-help">Seulement votre nom, votre téléphone et un mot de passe.</p>

      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <p className="tk-alert tk-alert-danger" role="alert">{error}</p>}

        <label className="block space-y-1">
          <span className="tk-label">Nom complet</span>
          <div className="tk-field">
            <UserRound className="tk-left" />
            <input className="input" required autoFocus autoComplete="name" placeholder="Ex : Awa Ouédraogo"
              value={form.name} onChange={set('name')} />
          </div>
        </label>

        <label className="block space-y-1">
          <span className="tk-label">Téléphone</span>
          <div className="tk-field">
            <Phone className="tk-left" />
            <input className="input tk-num" type="tel" inputMode="tel" required autoComplete="tel" placeholder="70 00 00 00"
              value={form.phone} onChange={set('phone')} />
          </div>
        </label>

        <label className="block space-y-1">
          <span className="tk-label">Mot de passe (4 caractères minimum)</span>
          <div className="tk-field">
            <Lock className="tk-left" />
            <input className="input" type={showPwd ? 'text' : 'password'} required minLength={4} autoComplete="new-password"
              value={form.password} onChange={set('password')} />
            <button type="button" className="tk-field-btn" onClick={() => setShowPwd((v) => !v)}
              aria-label={showPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
              {showPwd ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </label>

        {/* Choix du profil : boutons radio discrets */}
        <fieldset className="space-y-1">
          <legend className="tk-label">Je suis</legend>
          <div className="tk-pills tk-pills-block" role="radiogroup">
            {ROLES.map(({ v, label, icon: Icon }) => (
              <button key={v} type="button" role="radio" aria-checked={form.role === v} aria-selected={form.role === v}
                onClick={() => setForm({ ...form, role: v })}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
        </fieldset>

        <button className="btn-primary w-full" disabled={loading}>
          <UserPlus size={18} /> {loading ? 'Inscription…' : "S'inscrire"}
        </button>
      </form>

      <div className="tk-divider">OU</div>
      <p className="text-center text-sm" style={{ color: 'var(--tk-ink-2)' }}>
        Déjà inscrit ? <Link to="/login" className="font-semibold text-brand">Se connecter</Link>
      </p>
    </AuthShell>
  );
}
