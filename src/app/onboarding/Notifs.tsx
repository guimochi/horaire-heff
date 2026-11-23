import { useState } from 'preact/hooks';
import { promoLabel } from '../store';
import { subscribe } from '../push';

const Check = () => (
  <svg aria-hidden="true" class="icon-accent" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

const Example = ({ title, when, text }: { title: string; when: string; text: string }) => (
  <div class="notif-card">
    <img class="notif-icon" src="/apple-touch-icon.png" alt="" width="34" height="34" />
    <div class="notif-body">
      <div class="notif-top"><strong>{title}</strong><span>{when}</span></div>
      <span>{text}</span>
    </div>
  </div>
);

export function Notifs({ promo, onResult, onSkip }: {
  promo: string; onResult: (r: 'granted' | 'denied' | 'unsupported') => void; onSkip: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const activate = () => {
    setBusy(true);
    setFailed(false);
    // subscribe() must start inside this click handler (iOS user-gesture rule).
    subscribe(promo).then(onResult, () => { setFailed(true); setBusy(false); });
  };

  return (
    <div class="screen notifs">
      <div class="intro">
        <span class="step-label">Étape 3 sur 3</span>
        <h1 class="title">Plus besoin de vérifier sans arrêt</h1>
        <p class="lead">On surveille l'horaire de <strong>{promoLabel(promo)}</strong> et on te prévient dès que quelque chose change.</p>
      </div>

      <div class="notif-preview" aria-label="Exemples de notifications">
        <Example title="Cours annulé" when="maintenant" text="Act. gymniques 5 · aujourd'hui 13:00 n'aura pas lieu." />
        <Example title="Changement de local" when="il y a 2 h" text="AFP 3 · jeudi 10:00 → local 2.1.04 (au lieu de 1.0.07)." />
      </div>

      <ul class="checks">
        <li><Check />Cours annulé ou ajouté</li>
        <li><Check />Heure, local ou enseignant modifié</li>
        <li><Check />Uniquement pour ta promotion</li>
      </ul>

      <div class="notifs-actions">
        {failed && <p class="notifs-error" role="alert">L'activation n'a pas abouti. Vérifie ta connexion et réessaie.</p>}
        <button type="button" class="btn-primary" disabled={busy} onClick={activate}>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" /><path d="M10 19.5a2 2 0 0 0 4 0" /></svg>
          Activer les notifications
        </button>
        <button type="button" class="btn-link" onClick={onSkip}>Plus tard</button>
      </div>
    </div>
  );
}
