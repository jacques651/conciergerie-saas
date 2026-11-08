// Inscription en 3 étapes (rôle → identité → mot de passe). Même API qu'avant : POST /auth/register.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserRound, Store, Bike, Mail, Phone, Lock, Eye, EyeOff, ArrowLeft, ArrowRight, UserPlus } from 'lucide-react';
import api, { errMsg } from '../api';
import { useAuth } from '../auth.jsx';
import AuthShell from '../components/AuthShell.jsx';

const ROLES = [
  { v: 'client', label: 'Client', icon: UserRound, desc: 'Je cherche un livreur près de moi' },
  { v: 'commercant', label: 'Commerçant', icon: Store, desc: "J'envoie des livraisons à mes clients" }
  // Pas de « livreur » : les comptes livreurs sont créés et validés par l'administrateur
];

const STEPS = [
  { title: 'Votre profil', help: 'Client ou commerçant' },
  { title: 'Identité', help: 'Nom, email et téléphone' },
  { title: 'Sécurité', help: 'Mot de passe (6 caractères minimum)' }
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Register() {
  const { saveSession } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', role: 'client' });
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Validation locale de l'étape avant de passer à la suivante
  const next = () => {
    setError('');
    if (step === 1) {
      if (!form.name.trim()) return setError('Indiquez votre nom complet.');
      if (!EMAIL_RE.test(form.email)) return setError('Adresse email invalide.');
      if (form.phone && !/^[+0-9 ().-]{6,30}$/.test(form.phone.trim())) return setError('Numéro de téléphone invalide.');
    }
    setStep((s) => Math.min(s + 1, 2));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (step < 2) return next();
    if (form.password.length < 6) return setError('Mot de passe : 6 caractères minimum.');
    setError(''); setLoading(true);
    try {
      const { data } = await api.post('/auth/register', { ...form, phone: form.phone.trim() || undefined });
      saveSession(data);
      // Nouveau compte → aucun abonnement : paiement d'abord
      nav(data.role === 'livreur' ? '/livreur' : '/abonnement');
    } catch (e) { setError(errMsg(e)); }
    finally { setLoading(false); }
  };

  const role = ROLES.find((r) => r.v === form.role);

  return (
    <AuthShell steps={STEPS} current={step}>
      <span className="tk-eyebrow" style={{ color: 'var(--tk-accent-700)' }}>Étape {step + 1} sur 3</span>
      <h2 className="tk-step-title">{STEPS[step].title}</h2>

      <form onSubmit={submit} className="space-y-4">
        {error && <p className="tk-alert tk-alert-danger">{error}</p>}

        {step === 0 && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map((r) => {
                const Icon = r.icon;
                const sel = form.role === r.v;
                return (
                  <button type="button" key={r.v} onClick={() => setForm({ ...form, role: r.v })} aria-pressed={sel}
                    className="flex flex-col items-center gap-1 rounded-xl border p-3 text-sm transition"
                    style={{
                      borderColor: sel ? 'var(--tk-accent-500)' : 'var(--tk-border)',
                      background: sel ? 'var(--tk-accent-50)' : 'var(--tk-surface)',
                      boxShadow: sel ? 'var(--tk-focus-ring)' : 'none',
                      color: sel ? 'var(--tk-accent-700)' : 'var(--tk-ink-2)'
                    }}>
                    <Icon size={26} />
                    <span className="font-semibold">{r.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="tk-alert tk-alert-info">{role.desc}</p>
            <p className="flex items-start gap-2 text-xs" style={{ color: 'var(--tk-muted)' }}>
              <Bike size={14} className="mt-0.5 shrink-0" />
              <span>Vous êtes livreur ? Les comptes livreurs sont créés par l'administrateur après validation : contactez-le.</span>
            </p>
          </>
        )}

        {step === 1 && (
          <>
            <label className="block space-y-1">
              <span className="tk-label">Nom complet</span>
              <div className="tk-field">
                <UserRound className="tk-left" />
                <input className="input" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </label>
            <label className="block space-y-1">
              <span className="tk-label">Email</span>
              <div className="tk-field">
                <Mail className="tk-left" />
                <input className="input" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </label>
            <label className="block space-y-1">
              <span className="tk-label">Téléphone (facultatif)</span>
              <div className="tk-field">
                <Phone className="tk-left" />
                <input className="input" type="tel" autoComplete="tel" placeholder="ex. 70 00 00 00" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <span className="block text-xs text-gray-500">Permet aux commerçants de vous livrer sans ressaisir votre numéro.</span>
            </label>
          </>
        )}

        {step === 2 && (
          <>
            <label className="block space-y-1">
              <span className="tk-label">Mot de passe</span>
              <div className="tk-field">
                <Lock className="tk-left" />
                <input className="input" type={showPwd ? 'text' : 'password'} minLength={6} required autoFocus autoComplete="new-password"
                  value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <button type="button" className="tk-field-btn" onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
                  {showPwd ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </label>
            <div className="tk-detail-section grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
              <div className="tk-detail-tile"><p className="tk-kpi-label">Profil</p><p className="font-semibold">{role.label}</p></div>
              <div className="tk-detail-tile sm:col-span-2"><p className="tk-kpi-label">Compte</p><p className="truncate font-semibold">{form.name} · {form.email}</p></div>
            </div>
            <p className="tk-alert tk-alert-warning">
              Un abonnement (journalier, mensuel ou annuel) est requis pour accéder aux fonctionnalités.
            </p>
          </>
        )}

        <div className="flex gap-2">
          {step > 0 && (
            <button type="button" className="btn-ghost" onClick={() => { setError(''); setStep((s) => s - 1); }}>
              <ArrowLeft size={16} /> Retour
            </button>
          )}
          <button className="btn-primary flex-1" disabled={loading}>
            {step < 2
              ? <>Continuer <ArrowRight size={16} /></>
              : <><UserPlus size={18} /> {loading ? 'Création…' : 'Créer mon compte'}</>}
          </button>
        </div>
      </form>

      <div className="tk-divider">OU</div>
      <p className="text-center text-sm" style={{ color: 'var(--tk-ink-2)' }}>
        Déjà inscrit ? <Link to="/login" className="font-semibold text-brand">Se connecter</Link>
      </p>
    </AuthShell>
  );
}
