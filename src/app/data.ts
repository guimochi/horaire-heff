import { useEffect, useState } from 'preact/hooks';
import type { Change, Snapshot } from '../shared/types';

// offline = fetch threw (no network, nothing cached); error = 5xx or unreadable body.
export type LoadError = 'offline' | 'error';
export type Schedule = { state: 'loading' } | { state: 'pending' } | { state: LoadError }
  | { state: 'ready'; snapshot: Snapshot; lastSuccess: string | null };

/** Bumps when the app comes back to the foreground: refetch, and re-mark Changements as seen. */
export function useResume(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') setN((x) => x + 1); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return n;
}

/** Wall clock for « En cours » and « il y a N min », refreshed every 30 s and on resume. */
export function useNow(resume: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => setNow(new Date()), [resume]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  return now;
}

// `weeks` may be empty (no week published yet): the views show a calm state for it.
const isSnapshot = (s: any): s is Snapshot => !!s && Array.isArray(s.courses) && Array.isArray(s.weeks);

/** Schedule and feed for one promo. The service worker answers from its cache offline; a failed refetch keeps what is shown.
 * `visit` bumps when Changements is opened: the feed alone is refetched. */
export function useData(promo: string, resume: number, visit = 0) {
  const [schedule, setSchedule] = useState<Schedule>({ state: 'loading' });
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [changesError, setChangesError] = useState<LoadError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const p = encodeURIComponent(promo);
    fetch(`/api/schedule/${p}`)
      .then(async (r): Promise<Schedule> => {
        if (r.status === 404) return { state: 'pending' };
        const j = r.ok ? await r.json().catch(() => null) : null;
        return isSnapshot(j?.snapshot) ? { state: 'ready', snapshot: j.snapshot, lastSuccess: typeof j.lastSuccess === 'string' ? j.lastSuccess : null }
          : { state: 'error' };
      }, (): Schedule => ({ state: 'offline' }))
      .then((next) => { if (live) setSchedule((prev) => (prev.state === 'ready' && next.state !== 'ready' ? prev : next)); });
    return () => { live = false; };
  }, [promo, resume, attempt]);

  useEffect(() => {
    let live = true;
    fetch(`/api/changes/${encodeURIComponent(promo)}`)
      .then(async (r): Promise<Change[] | LoadError> => {
        const list: unknown = r.ok ? await r.json().catch(() => null) : null;
        return Array.isArray(list) ? (list as Change[]) : 'error';
      }, (): LoadError => 'offline')
      .then((v) => {
        if (!live) return;
        if (Array.isArray(v)) { setChanges(v); setChangesError(null); } else setChangesError(v);
      });
    return () => { live = false; };
  }, [promo, resume, attempt, visit]);

  return { schedule, changes, changesError, retry: () => setAttempt((n) => n + 1) };
}
