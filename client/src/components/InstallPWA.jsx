// Bannière d'installation de l'application (PWA), discrète, en bas de l'écran.
// - Android / Chrome / Edge : écoute "beforeinstallprompt" puis déclenche prompt() au clic.
// - iPhone / iPad (Safari) : pas d'évènement → instructions « Partager → Sur l'écran d'accueil ».
// - Rien n'est affiché si l'application est déjà installée (mode standalone).
import { useEffect, useState } from 'react';
import { Download, Share, X, Bike } from 'lucide-react';

const DISMISS_KEY = 'tk-install-dismissed-at';
const DISMISS_DAYS = 7; // la bannière revient au bout d'une semaine si elle a été fermée

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

function recentlyDismissed() {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return t && Date.now() - t < DISMISS_DAYS * 86400000;
  } catch { return false; }
}

export default function InstallPWA() {
  const [deferred, setDeferred] = useState(null); // évènement beforeinstallprompt mis de côté
  const [showIos, setShowIos] = useState(false);
  const [hidden, setHidden] = useState(() => isStandalone() || recentlyDismissed());

  useEffect(() => {
    if (isStandalone()) return;
    const onPrompt = (e) => {
      e.preventDefault(); // on garde l'évènement pour l'afficher au bon moment (notre bannière)
      setDeferred(e);
    };
    const onInstalled = () => { setDeferred(null); setHidden(true); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    // iOS Safari : aucune API d'installation, on affiche les instructions
    if (isIos()) setShowIos(true);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* stockage indisponible */ }
    setHidden(true);
  };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try {
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') setHidden(true);
    } finally {
      setDeferred(null); // un évènement ne peut servir qu'une fois
    }
  };

  if (hidden || (!deferred && !showIos)) return null;

  return (
    <div className="tk-install" role="dialog" aria-label="Installer l'application">
      <span className="tk-install-icon"><Bike size={22} /></span>
      <div className="min-w-0 flex-1">
        <p className="tk-install-title">Installer l'application sur votre téléphone</p>
        {deferred ? (
          <p className="tk-install-text">Accès en un geste depuis l'écran d'accueil, en plein écran, comme une vraie application.</p>
        ) : (
          <p className="tk-install-text">
            Touchez <Share size={13} className="inline -mt-0.5" aria-label="Partager" /> <b>Partager</b>, puis <b>« Sur l'écran d'accueil »</b>.
          </p>
        )}
      </div>
      {deferred && (
        <button className="btn-primary shrink-0 px-3 py-2 text-sm" onClick={install}>
          <Download size={16} /> Installer
        </button>
      )}
      <button className="tk-install-close" onClick={dismiss} aria-label="Plus tard"><X size={18} /></button>
    </div>
  );
}
