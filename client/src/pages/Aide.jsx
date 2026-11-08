// Guide d'utilisation intégré : questions fréquentes par rôle (accordéons + captures d'écran).
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, UserRound, Bike, Store, LifeBuoy, ImageOff } from 'lucide-react';
import AppLayout from '../components/AppLayout.jsx';
import { useAuth } from '../auth.jsx';

/** Capture d'écran avec repli sur un cadre « placeholder » si l'image est absente */
function Shot({ src, alt, caption }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="tk-shot">
      {failed || !src ? (
        <div className="tk-shot-placeholder" role="img" aria-label={alt}><ImageOff size={22} /> Capture à venir</div>
      ) : (
        <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
      )}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function Faq({ q, steps, note, shot, open = false }) {
  return (
    <details className="tk-faq" open={open}>
      <summary>{q}<ChevronDown size={18} className="tk-faq-chevron" /></summary>
      <div className={`tk-faq-body ${shot ? 'has-shot' : ''}`}>
        <div className="space-y-3">
          <ol>{steps.map((s, i) => <li key={i}><span>{s}</span></li>)}</ol>
          {note && <p className="tk-alert tk-alert-info">{note}</p>}
        </div>
        {shot && <Shot {...shot} />}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Contenu du guide (fidèle aux fonctionnalités réelles de l'application)
// ---------------------------------------------------------------------------
const SECTIONS = {
  client: {
    label: 'Pour les Clients', icon: UserRound,
    items: [
      {
        q: 'Comment commander ?',
        steps: [
          <>Une livraison est créée par le <b>commerçant</b> chez qui vous achetez. Communiquez-lui l'<b>adresse email de votre compte</b> : il vous sélectionne comme « Client de la plateforme ».</>,
          <>Vous recevez une notification <b>« Nouvelle commande en route ! »</b> et la commande apparaît dans <b>Mes commandes</b> (bouton en haut de la carte).</>,
          <>Besoin d'un coursier sans passer par un commerçant ? Sur la carte, <b>touchez un livreur disponible</b> : votre position lui est envoyée et une conversation s'ouvre pour vous mettre d'accord.</>
        ],
        note: 'Renseignez votre téléphone à l’inscription : le commerçant n’aura pas à le ressaisir.',
        shot: { src: '/aide/client-commandes.webp', alt: 'Fenêtre Mes commandes', caption: 'Mes commandes : commandes en cours et livrées' }
      },
      {
        q: 'Comment suivre mon livreur ?',
        steps: [
          <>Ouvrez <b>Mes commandes</b>, onglet <b>En cours</b> : la distance entre le livreur et votre adresse s'actualise en temps réel.</>,
          <>Sur la carte, le livreur en livraison apparaît en rouge avec son <b>tracé</b> ; le panneau <b>« Suivi en direct »</b> indique sa distance.</>,
          <>Le bouton <b>Livreur</b> d'une commande ouvre la messagerie pour lui écrire.</>,
          <>Une fois la commande livrée, cliquez sur <b>« Noter le livreur »</b> (1 à 5 étoiles et un commentaire).</>
        ],
        shot: { src: '/aide/client-carte.webp', alt: 'Carte avec suivi en direct', caption: 'Carte : livreurs disponibles et suivi en direct' }
      },
      {
        q: 'Comment payer mon abonnement ?',
        steps: [
          <>Menu <b>Mon abonnement</b>, puis choisissez une formule : <b>journalière, mensuelle ou annuelle</b>.</>,
          <>Vérifiez le montant affiché, puis cliquez sur <b>Payer</b> : vous êtes redirigé vers la page sécurisée <b>FedaPay</b>.</>,
          <>Choisissez <b>Orange Money</b> ou <b>Moov Money</b>, saisissez votre numéro et validez l'opération sur votre téléphone.</>,
          <>De retour dans l'application, l'abonnement s'active automatiquement. Sinon, cliquez sur <b>« Vérifier mon statut »</b>.</>
        ],
        note: 'Un nouvel achat s’ajoute à la durée restante : vous ne perdez aucun jour.',
        shot: { src: '/aide/abonnement.webp', alt: 'Choix de la formule d’abonnement', caption: 'Mon abonnement : formules et compte à rebours' }
      }
    ]
  },
  livreur: {
    label: 'Pour les Livreurs', icon: Bike,
    items: [
      {
        q: 'Comment accepter une mission ?',
        steps: [
          <>Votre compte doit être <b>validé par un administrateur</b> et votre <b>abonnement actif</b>.</>,
          <>Dans <b>Espace livreur</b>, touchez <b>« Se mettre en ligne »</b> : les commerçants proches vous voient.</>,
          <>Une nouvelle mission déclenche un <b>son</b> et une notification. Dans l'onglet <b>Missions</b>, lisez les détails et le prix, puis <b>Accepter</b> ou <b>Refuser</b>.</>,
          <>Touchez <b>« Démarrer la livraison »</b> au départ, utilisez <b>📞 Appeler</b> ou <b>Itinéraire</b> si besoin, puis <b>« Terminer la livraison »</b> à la remise du colis.</>
        ],
        shot: { src: '/aide/livreur-mission.webp', alt: 'Carte de mission livreur', caption: 'Mission : client, prix de la course, détails' }
      },
      {
        q: 'Comment activer mon GPS ?',
        steps: [
          <>Activez la <b>localisation</b> (GPS) dans les réglages rapides de votre téléphone.</>,
          <>Ouvrez l'application en <b>https://</b> (ou depuis l'icône installée). Le navigateur refuse le GPS sur une adresse non sécurisée.</>,
          <>À la question du navigateur, choisissez <b>Autoriser</b>. Si vous avez refusé : touchez le <b>cadenas</b> à gauche de l'adresse → Autorisations → Position → Autoriser.</>,
          <>En ligne, l'indicateur <b>« 📡 Position envoyée »</b> en bas de la carte confirme l'envoi (toutes les 5 secondes).</>
        ],
        note: 'Un bandeau rouge en haut de l’écran explique la cause exacte si le GPS est bloqué.'
      },
      {
        q: 'Comment recevoir mon argent ?',
        steps: [
          <>Le <b>prix de la course</b> est indiqué sur chaque mission par le commerçant.</>,
          <>L'application <b>n'encaisse pas</b> les courses : le paiement se fait directement entre vous et le commerçant (ou le client), en espèces ou par Mobile Money, selon votre accord.</>,
          <>Suivez vos revenus : <b>Gains du jour</b> en haut de l'écran, et l'onglet <b>Historique</b> pour toutes vos livraisons terminées et les notes reçues.</>
        ],
        note: 'Seul l’abonnement à la plateforme est payé dans l’application (via FedaPay).'
      }
    ]
  },
  commercant: {
    label: 'Pour les Commerçants', icon: Store,
    items: [
      {
        q: 'Comment créer une mission ?',
        steps: [
          <>Dans <b>Espace commerçant</b>, choisissez un livreur (onglet <b>Livreurs</b> ou directement sur la carte).</>,
          <>Onglet <b>Mission</b> : <b>cliquez sur la carte</b> pour placer l'adresse de livraison.</>,
          <>Sélectionnez un <b>client de la plateforme</b> (il pourra suivre et noter) ou saisissez nom et téléphone.</>,
          <>Indiquez les <b>détails de la commande</b> et les <b>frais de livraison</b>, puis <b>Envoyer la mission</b>.</>,
          <>Suivez-la dans <b>Suivi</b> (position et distances en direct), puis retrouvez-la dans <b>Historique</b> pour noter le livreur.</>
        ],
        shot: { src: '/aide/commercant-mission.webp', alt: 'Formulaire de mission', caption: 'Formulaire : client, détails, frais de livraison' }
      },
      {
        q: 'Comment choisir un livreur ?',
        steps: [
          <>L'onglet <b>Livreurs</b> liste les livreurs <b>en ligne</b> et abonnés, <b>du plus proche au plus éloigné</b>.</>,
          <>Privilégiez le plus proche pour une livraison rapide ; la distance est recalculée en temps réel.</>,
          <>Un doute ? Écrivez-lui avant d'envoyer la mission (onglet <b>Messages</b>).</>,
          <>Un livreur déjà en livraison n'apparaît pas dans la liste : il redevient disponible dès qu'il termine.</>
        ]
      }
    ]
  },
  general: {
    label: 'Général', icon: LifeBuoy,
    items: [
      {
        q: 'Comment installer l’application sur mon téléphone ?',
        steps: [
          <><b>Android (Chrome)</b> : touchez <b>« Installer »</b> dans la bannière en bas de l'écran, ou menu ⋮ → <b>Installer l'application</b>.</>,
          <><b>iPhone (Safari)</b> : touchez <b>Partager</b>, puis <b>« Sur l'écran d'accueil »</b>.</>,
          <>L'icône <b>Conciergerie</b> apparaît sur l'écran d'accueil : l'application s'ouvre en plein écran.</>
        ]
      },
      {
        q: 'Je me suis inscrit mais je ne peux pas me connecter',
        steps: [
          <>Chaque nouveau compte (client, commerçant ou livreur) est <b>vérifié par un administrateur</b> avant sa première utilisation.</>,
          <>Tant que la vérification n'est pas faite, la connexion affiche <b>« Votre compte est en attente d'approbation »</b> : réessayez plus tard.</>,
          <>Si votre demande a été refusée, contactez l'administrateur pour en connaître la raison.</>
        ]
      },
      {
        q: 'Mon abonnement a expiré, que se passe-t-il ?',
        steps: [
          <>Vous êtes redirigé vers <b>Mon abonnement</b> : la carte, les missions et la messagerie sont suspendues.</>,
          <>Payez une nouvelle formule : l'accès revient immédiatement après confirmation.</>
        ]
      },
      {
        q: 'Comment passer en mode sombre ?',
        steps: [<>Touchez l'icône <b>lune / soleil</b> en haut à droite. Votre choix est mémorisé sur cet appareil.</>]
      }
    ]
  }
};

const ORDER = ['client', 'livreur', 'commercant', 'general'];

export default function Aide() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const initial = params.get('role') && SECTIONS[params.get('role')] ? params.get('role') : (SECTIONS[user?.role] ? user.role : 'client');
  const [tab, setTab] = useState(initial);
  const select = (k) => { setTab(k); setParams({ role: k }, { replace: true }); };
  const section = SECTIONS[tab];

  return (
    <AppLayout title="Aide et guide d'utilisation">
      <nav className="tk-pills shrink-0 self-start overflow-x-auto" role="tablist">
        {ORDER.map((k) => {
          const Icon = SECTIONS[k].icon;
          return (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => select(k)}>
              <Icon size={15} /> {SECTIONS[k].label}
            </button>
          );
        })}
      </nav>

      <section className="mx-auto w-full max-w-5xl" aria-label={section.label}>
        {section.items.map((it, i) => <Faq key={`${tab}-${i}`} {...it} open={i === 0} />)}
      </section>

      <p className="pb-4 text-center text-xs text-gray-500">
        Une question sans réponse ? Écrivez à un administrateur depuis la messagerie, ou contactez votre commerçant.
      </p>
    </AppLayout>
  );
}
