import { useState } from 'preact/hooks';
import type { Change } from '../../shared/types';
import type { Schedule } from '../data';
import { HP_URL } from '../../shared/hp';
import { changeCard, changesModel, clearStamp, freshness, relTime, splitSeen } from '../model';
import { promoLabel } from '../store';
import { Icon } from '../components/Icon';
import { Calm, StaleBanner, Updated } from '../components/Status';

function ChangeCard({ c, now, earlier }: { c: Change; now: Date; earlier?: boolean }) {
  const v = changeCard(c);
  return (
    <article class={`change${earlier ? ' is-earlier' : ''}`}>
      <div class="change-top">
        <span class={`change-label tone-${v.tone}`}><Icon name={v.icon} size={16} width={2} />{v.label}</span>
        <span class="change-when">{relTime(c.detectedAt, now)}</span>
      </div>
      <h3>{v.title}</h3>
      {v.detail && <p class="change-detail">{v.detail}</p>}
      {v.from !== undefined && (
        <div class="change-diff">
          <span class="change-from"><span class="sr-only">Avant : </span>{v.from}</span>
          <span class="change-arrow"><Icon name="move" size={18} width={2} /></span>
          <strong class="change-to"><span class="sr-only">Après : </span>{v.to}</strong>
        </div>
      )}
    </article>
  );
}

/** `seenBefore` = lastSeenAt as it was when the view opened (ruling R21). `changes` null = feed not loaded. */
export function Changes({ promo, schedule, changes, now, seenBefore, clearedAt, setClearedAt, failed, retry }: {
  promo: string; schedule?: Schedule; changes: Change[] | null; now: Date; seenBefore: string | null;
  clearedAt: string | null; setClearedAt: (v: string | null) => void; failed?: 'offline' | 'error' | null; retry?: () => void;
}) {
  // The clearedAt to restore with « Annuler »; undefined = nothing to undo.
  const [undo, setUndo] = useState<string | null | undefined>(undefined);
  const { visible } = changesModel(changes ?? [], clearedAt, null);
  const { fresh, earlier } = splitSeen(visible, seenBefore);

  // Same freshness as Jour: an empty feed over a stale read is not « à jour ».
  const ready = schedule?.state === 'ready' ? schedule : null;
  const stale = !!ready && freshness(ready.snapshot, ready.lastSuccess, now).stale;

  const clear = () => { setUndo(clearedAt); setClearedAt(clearStamp(visible)); };
  const restore = () => { setClearedAt(undo ?? null); setUndo(undefined); };

  return (
    <div class="view">
      <header class="view-head">
        <div class="head-row">
          <span class="promo-pill">{promoLabel(promo)}</span>
          {visible.length > 0 && (
            <button type="button" class="chip-btn" onClick={clear}><Icon name="check" size={18} width={2} />Tout effacer</button>
          )}
        </div>
        <div class="head-title">
          <h1 class="h-big">Changements</h1>
          <p class="sub sub-15">Tout ce qui a bougé dans ton horaire</p>
        </div>
      </header>

      <main class="view-main changes-main">
        {ready && <StaleBanner s={ready.snapshot} lastSuccess={ready.lastSuccess} now={now} />}
        {changes === null && <Calm kind={failed ?? 'loading'} retry={retry} />}
        {changes !== null && visible.length === 0 && (
          <div class="all-clear">
            <span class="calm-tile"><Icon name="check" size={34} /></span>
            <h2>{stale ? 'Aucun changement reçu' : 'Tout est à jour'}</h2>
            <p>Les prochains changements apparaîtront ici, et tu recevras une notification.</p>
            {undo !== undefined && <button type="button" class="btn-link btn-undo" onClick={restore}>Annuler</button>}
          </div>
        )}
        {fresh.length > 0 && <h2 class="feed-head">Nouveau</h2>}
        {fresh.map((c) => <ChangeCard key={c.id} c={c} now={now} />)}
        {earlier.length > 0 && <h2 class={`feed-head${fresh.length ? ' feed-later' : ''}`}>Plus tôt</h2>}
        {earlier.map((c) => <ChangeCard key={c.id} c={c} now={now} earlier />)}
        {ready && <Updated s={ready.snapshot} lastSuccess={ready.lastSuccess} now={now} />}
        <a class="hp-link" href={HP_URL} target="_blank" rel="noopener">
          Vérifier sur Hyperplanning<Icon name="external" size={16} width={2} />
        </a>
      </main>
    </div>
  );
}
