import { useEffect, useState } from 'preact/hooks';
import { searchPromos } from '../store';

type Load = { state: 'loading' } | { state: 'ready'; list: string[] } | { state: 'unavailable' };

// Reused by Réglages: `inSettings` hides the onboarding step label and the « réglages » hint; `onCancel` adds a way back.
export function Promo({ initial, onDone, inSettings = false, onCancel }: {
  initial: string | null; onDone: (promo: string) => void; inSettings?: boolean; onCancel?: () => void;
}) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(initial);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoad({ state: 'loading' });
    fetch('/api/promos')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((list: unknown) => {
        const ok = Array.isArray(list) && list.length > 0 && list.every((p) => typeof p === 'string');
        if (live) setLoad(ok ? { state: 'ready', list: list as string[] } : { state: 'unavailable' });
      })
      .catch(() => { if (live) setLoad({ state: 'unavailable' }); });
    return () => { live = false; };
  }, [attempt]);

  const hits = load.state === 'ready' ? searchPromos(load.list, q) : [];
  const count = hits.length === 1 ? '1 promotion' : `${hits.length} promotions`;

  return (
    <div class="screen promo">
      <div class="intro">
        {!inSettings && <span class="step-label">Étape 2 sur 3</span>}
        <h1 class="title">Quelle est ta promotion ?</h1>
        <p class="lead">Tu ne verras que celle-ci.{!inSettings && ' Tu pourras la changer dans les réglages.'}</p>
      </div>

      <label class="search">
        <svg aria-hidden="true" class="icon-muted" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <span class="sr-only">Rechercher une promotion</span>
        <input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Ex. BA3 EPS, MATH, 3 SC…"
          autocomplete="off" autocapitalize="off" spellcheck={false} enterkeyhint="search" />
      </label>

      <div class="results">
        {load.state === 'loading' && <p class="calm" role="status">Chargement des promotions…</p>}
        {load.state === 'unavailable' && (
          <div class="calm-box" role="status">
            <p class="calm">La liste des promotions n'est pas encore disponible. Réessaie un peu plus tard.</p>
            <button type="button" class="btn-link" onClick={() => setAttempt((n) => n + 1)}>Réessayer</button>
          </div>
        )}
        {load.state === 'ready' && (
          <>
            <span class="results-count" aria-live="polite">{count}</span>
            {/* Every hit, scrollable: the mockup's slice(0, 7) only fit a static artboard. */}
            <ul>
              {hits.map((p) => (
                <li key={p}>
                  <button type="button" class="promo-row" aria-pressed={p === picked} onClick={() => setPicked(p)}>
                    <span>{p}</span>
                    {p === picked && <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                  </button>
                </li>
              ))}
            </ul>
            {hits.length === 0 && <p class="calm">Aucune promotion ne correspond. Essaie juste « BA3 » ou « EPS ».</p>}
          </>
        )}
      </div>

      <button type="button" class="btn-primary" disabled={!picked} onClick={() => picked && onDone(picked)}>
        {picked ? `Continuer avec ${picked}` : 'Continuer'}
      </button>
      {onCancel && <button type="button" class="btn-link promo-cancel" onClick={onCancel}>Annuler</button>}
    </div>
  );
}
