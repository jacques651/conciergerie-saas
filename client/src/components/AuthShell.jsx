// Cadre des écrans d'accueil (connexion, inscription) : fond sombre plein écran,
// carte 2 colonnes (panneau sombre à gauche, formulaire à droite). Une colonne sous 820 px.
import { Bike, Check } from 'lucide-react';
import { COMPANY } from './AppLayout.jsx';

/** Écusson (comme la maquette), avec pictogramme livreur */
export function Crest() {
  return (
    <div className="tk-crest" aria-hidden>
      <div className="tk-crest-inner"><Bike size={64} strokeWidth={1.6} /></div>
    </div>
  );
}

/**
 * props :
 *  left  : contenu personnalisé du panneau gauche (sinon écusson + titre)
 *  steps : [{ title, help }] + current (index) → étapes verticales
 */
export default function AuthShell({ steps, current = 0, children }) {
  return (
    <div className="tk-auth">
      <div className="tk-auth-card">
        <aside className="tk-auth-left">
          <Crest />
          <span className="tk-eyebrow">{COMPANY}</span>
          <h1>Conciergerie</h1>
          <p className="tk-auth-sub">Coordination des livreurs de quartier · carte temps réel · messagerie</p>
          {steps && (
            <ol className="tk-steps">
              {steps.map((s, i) => (
                <li key={s.title} className={`tk-step ${i === current ? 'is-current' : ''} ${i < current ? 'is-done' : ''}`}>
                  <span className="tk-step-dot">{i < current ? <Check size={14} /> : i + 1}</span>
                  <span>
                    <span className="tk-step-title block">{s.title}</span>
                    <span className="tk-step-help block">{s.help}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </aside>
        <section className="tk-auth-right">{children}</section>
      </div>
    </div>
  );
}
