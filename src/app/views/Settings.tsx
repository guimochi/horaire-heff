import { useEffect, useState } from 'preact/hooks';
import { HP_URL } from '../../shared/hp';
import { notificationPermission, promoLabel } from '../store';
import { currentSubscription, subscribe, unsubscribe } from '../push';
import { Promo } from '../onboarding/Promo';
import { Icon } from '../components/Icon';

type Notif = 'loading' | 'on' | 'off' | 'busy' | 'unsupported' | 'denied';

const HINT: Partial<Record<Notif, string>> = {
  unsupported: "Les notifications ne sont pas disponibles ici. Sur iPhone, ouvre l'app depuis son icône sur l'écran d'accueil.",
  denied: 'Les notifications sont bloquées. Autorise-les dans Réglages › Notifications › Horaire.',
};

export function Settings({ promo, onPromo }: { promo: string; onPromo: (p: string) => void }) {
  const [picking, setPicking] = useState(false);
  const [notif, setNotif] = useState<Notif>('loading');

  const [failed, setFailed] = useState(false);

  // Real state (ruling R17): on only when a push subscription exists, re-read after every attempt.
  const refresh = () => {
    const perm = notificationPermission();
    if (perm === 'unsupported') { setNotif('unsupported'); return Promise.resolve(); }
    return currentSubscription().then((sub) => setNotif(sub ? 'on' : perm === 'denied' ? 'denied' : 'off'), () => setNotif('off'));
  };
  useEffect(() => { refresh(); }, []);

  const toggle = () => {
    // subscribe() first in the click handler: iOS grants the prompt to a user gesture only.
    const attempt = notif === 'on' ? unsubscribe() : subscribe(promo);
    setNotif('busy');
    setFailed(false);
    attempt.then((r) => { if (r === 'unsupported') setNotif('unsupported'); else refresh(); },
      () => { setFailed(true); refresh(); });
  };

  if (picking) {
    return <Promo initial={promo} inSettings onCancel={() => setPicking(false)}
      onDone={(p) => { if (p !== promo) onPromo(p); setPicking(false); }} />;
  }

  const on = notif === 'on';
  return (
    <div class="view">
      <header class="view-head">
        <div class="head-row">
          <span class="promo-pill">{promoLabel(promo)}</span>
          <a class="icon-btn" href="#/jour" aria-label="Retour à Aujourd'hui"><Icon name="prev" size={20} width={2} /></a>
        </div>
        <div class="head-title"><h1 class="h-big">Réglages</h1></div>
      </header>

      <main class="view-main">
        <ul class="settings">
          <li>
            <button type="button" class="settings-row" onClick={() => setPicking(true)}>
              <span class="settings-text"><span>Changer de promotion</span><span class="settings-sub">{promoLabel(promo)}</span></span>
              <Icon name="next" size={18} width={2} />
            </button>
          </li>
          <li>
            <button type="button" class="settings-row" role="switch" aria-checked={on} onClick={toggle}
              disabled={notif === 'loading' || notif === 'busy' || notif === 'unsupported'}>
              <span class="settings-text"><span>Notifications</span><span class="settings-sub">Préviens-moi quand mon horaire change</span></span>
              <span class={`switch${on ? ' is-on' : ''}`} aria-hidden="true"><span /></span>
            </button>
          </li>
          <li>
            <a class="settings-row" href={HP_URL} target="_blank" rel="noopener">
              <span class="settings-text"><span>Ouvrir Hyperplanning</span></span>
              <Icon name="external" size={18} width={2} />
            </a>
          </li>
        </ul>
        {failed && <p class="settings-hint" role="alert">Ça n'a pas marché. Vérifie ta connexion et réessaie.</p>}
        {HINT[notif] && <p class="settings-hint" role="status">{HINT[notif]}</p>}
      </main>
    </div>
  );
}
