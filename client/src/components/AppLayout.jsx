// Layout Vert-ardoise : barre latérale + barre supérieure (thème, menu utilisateur) + bannière de page.
// Chaque écran fournit seulement son titre (onglet), ses actions éventuelles et son contenu.
import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Bike, Map as MapIcon, LayoutDashboard, CreditCard, Store, Truck, PanelLeftClose, PanelLeftOpen,
  Moon, Sun, ChevronDown, KeyRound, LogOut, Wallet, CircleHelp
} from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { useTheme, useSidebarCollapsed } from '../theme';
import SubscriptionBanner from './SubscriptionBanner.jsx';
import Modal from './Modal.jsx';

export const COMPANY = 'GestionLivraison';
const APP_NAME = 'Conciergerie';
const ROLE_LABEL = { admin: 'Administrateur', client: 'Client', livreur: 'Livreur', commercant: 'Commerçant' };

// Lien « Aide » commun à tous les rôles (ajouté en fin de menu)
const HELP_LINK = { to: '/aide', label: 'Aide', icon: CircleHelp };

// Liens de navigation par rôle
const NAV = {
  admin: [
    { to: '/admin', label: 'Administration', icon: LayoutDashboard, end: true },
    { to: '/admin/subscriptions', label: 'Abonnements', icon: Wallet }
  ],
  client: [
    { to: '/carte', label: 'Livreurs autour de moi', icon: MapIcon },
    { to: '/abonnement', label: 'Mon abonnement', icon: CreditCard }
  ],
  livreur: [
    { to: '/livreur', label: 'Espace livreur', icon: Truck },
    { to: '/abonnement', label: 'Mon abonnement', icon: CreditCard }
  ],
  commercant: [
    { to: '/commercant', label: 'Espace commerçant', icon: Store },
    { to: '/abonnement', label: 'Mon abonnement', icon: CreditCard }
  ]
};

/** « Jacques Korgo » → « J. KORGO » */
export function shortName(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name;
  return `${parts[0][0].toUpperCase()}. ${parts.slice(1).join(' ').toUpperCase()}`;
}
const initials = (name = '?') => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="tk-user" ref={ref}>
      <button className="tk-user-pill" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span className="tk-avatar">{initials(user?.name)}</span>
        <span className="tk-user-text">
          <span className="tk-user-name block">{shortName(user?.name)}</span>
          <span className="tk-user-role block">{ROLE_LABEL[user?.role] || user?.role}</span>
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="tk-user-menu" role="menu">
          <button role="menuitem" onClick={() => { setOpen(false); setPwdOpen(true); }}><KeyRound size={16} /> Changer le mot de passe</button>
          <button role="menuitem" className="is-danger" onClick={logout}><LogOut size={16} /> Déconnexion</button>
        </div>
      )}
      <Modal open={pwdOpen} onClose={() => setPwdOpen(false)} title="Changer le mot de passe" icon={KeyRound} width={440}>
        <div className="space-y-3 text-sm">
          <p className="tk-alert tk-alert-info">Le changement de mot de passe en ligne n'est pas encore disponible.</p>
          <p style={{ color: 'var(--tk-ink-2)' }}>Contactez l'administrateur pour réinitialiser votre mot de passe.</p>
          <div className="flex justify-end"><button className="btn-primary" onClick={() => setPwdOpen(false)}>Compris</button></div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * props :
 *  title    : nom de l'onglet (affiché dans la bannière)
 *  actions  : éléments affichés à droite de la bannière (chips, boutons)
 *  fill     : true → le contenu remplit la hauteur restante (écrans carte), sans défilement de page
 *  banner   : false → pas de bannière (rare)
 */
export default function AppLayout({ title, actions, fill = false, banner = true, children }) {
  const { user } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const links = [...(NAV[user?.role] || []), HELP_LINK];

  return (
    <div className="tk-shell">
      <aside className="tk-sidebar">
        <div className="tk-sidebar-head">
          <div className="tk-sidebar-brand">
            <span className="tk-eyebrow">{COMPANY}</span>
            <span className="tk-sidebar-title"><Bike size={20} /> {APP_NAME}</span>
          </div>
          <button className="tk-sidebar-toggle" onClick={toggleCollapsed}
            title={collapsed ? 'Afficher la barre latérale' : 'Rabattre la barre latérale'}
            aria-label={collapsed ? 'Afficher la barre latérale' : 'Rabattre la barre latérale'}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <nav className="tk-nav">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} title={label}>
              <Icon /> <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="tk-sidebar-foot">
          <div className="tk-license" title={`${APP_NAME} v1.0 · Licence Active`}>
            <span className="tk-license-dot" /> <span>{APP_NAME} v1.0 · Licence Active</span>
          </div>
        </div>
      </aside>

      <div className="tk-main">
        <header className="tk-topbar">
          <NavLink to="/aide" className="tk-round-btn" title="Aide" aria-label="Aide et guide d'utilisation"><CircleHelp size={18} /></NavLink>
          <button className="tk-round-btn" onClick={toggleTheme}
            title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
            aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <UserMenu />
        </header>

        <main className={`tk-content ${fill ? 'tk-content-fill' : ''}`}>
          {user?.role !== 'admin' && <div className="-mb-2 overflow-hidden rounded-xl"><SubscriptionBanner /></div>}
          {banner && (
            <section className="tk-banner">
              <div>
                <span className="tk-eyebrow">{COMPANY}</span>
                <h1>{title}</h1>
              </div>
              {actions && <div className="tk-banner-actions">{actions}</div>}
            </section>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
