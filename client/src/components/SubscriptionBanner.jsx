// Bandeau "Abonnement actif jusqu'à X" (avec compte à rebours).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { formatRemaining } from '../pages/Abonnement.jsx';

export default function SubscriptionBanner() {
  const { subscription } = useAuth();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  if (!subscription || subscription.exempt) return null;
  const ms = subscription.expires_at ? Date.parse(subscription.expires_at) - now : 0;
  const active = subscription.active && ms > 0;
  const low = active && ms < 2 * 3600e3; // moins de 2h

  return (
    <div className={`tk-alert flex items-center justify-between gap-2 py-2 text-xs ${!active ? 'tk-alert-danger' : low ? 'tk-alert-warning' : 'tk-alert-success'}`}>
      <span className="truncate">
        {active
          ? <>Abonnement actif jusqu'à {new Date(subscription.expires_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} {new Date(subscription.expires_at).toLocaleDateString('fr-FR')} · <span className="font-mono">{formatRemaining(ms)}</span></>
          : 'Abonnement expiré'}
      </span>
      <Link to="/abonnement" className="shrink-0 font-semibold underline">{active ? 'Prolonger' : "S'abonner"}</Link>
    </div>
  );
}
