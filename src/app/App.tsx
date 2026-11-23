import { useEffect, useRef, useState } from 'preact/hooks';
import { getClearedAt, getLastSeenAt, getNotifsSkipped, getPromo, isIOS, isStandalone, notificationPermission, onboardingStep,
  setClearedAt, setLastSeenAt, setNotifsSkipped, setPromo } from './store';
import { resync } from './push';
import { useData, useNow, useResume } from './data';
import { changesModel, seenStamp } from './model';
import { Day } from './views/Day';
import { Week } from './views/Week';
import { Changes } from './views/Changes';
import { Settings } from './views/Settings';
import { TabBar } from './components/TabBar';
import { Install } from './onboarding/Install';
import { Promo } from './onboarding/Promo';
import { Notifs } from './onboarding/Notifs';

export type Route = 'jour' | 'semaine' | 'changements' | 'reglages';
const ROUTES: Route[] = ['jour', 'semaine', 'changements', 'reglages'];

// '#/changements' -> 'changements'; anything unknown falls back to the day view.
const routeOf = (hash: string): Route => ROUTES.find((r) => hash === `#/${r}`) ?? 'jour';

function useRoute(): Route {
  const [route, setRoute] = useState(() => routeOf(location.hash));
  useEffect(() => {
    const on = () => setRoute(routeOf(location.hash));
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

function Shell({ promo, route, onPromo }: { promo: string; route: Route; onPromo: (p: string) => void }) {
  const resume = useResume();
  const now = useNow(resume);
  // Opening Changements (hashchange, not only resume) refetches the feed.
  const [visit, setVisit] = useState(0);
  const lastRoute = useRef(route);
  useEffect(() => { if (route === 'changements' && lastRoute.current !== route) setVisit((n) => n + 1); lastRoute.current = route; }, [route]);
  const { schedule, changes, changesError, retry } = useData(promo, resume, visit);
  const [clearedAt, setCleared] = useState(getClearedAt);
  const [lastSeenAt, setSeen] = useState(getLastSeenAt);
  const [seenBefore, setSeenBefore] = useState(lastSeenAt);

  // Ruling R17: re-register an existing subscription silently; never subscribe() without a gesture. Runs per promo (Shell is keyed).
  useEffect(() => { if (notificationPermission() === 'granted') resync(promo).catch(() => {}); }, []);

  // First load with nothing seen yet (first launch, promo change): the backlog is not unread. An empty feed stores the
  // epoch, so the first change that arrives later still counts.
  useEffect(() => {
    if (changes === null || lastSeenAt !== null) return; // state, not storage: blocked storage must not re-mark every load
    const t = seenStamp(changes) ?? new Date(0).toISOString();
    setLastSeenAt(t);
    setSeen(t);
    setSeenBefore(t);
  }, [changes]);

  // Opening Changements (or coming back to it) captures the split point; the sections split on the value from before.
  useEffect(() => { if (route === 'changements') setSeenBefore(getLastSeenAt()); }, [route, resume]);
  // R23: then mark seen with the newest loaded detectedAt (server time), only once the feed has loaded.
  useEffect(() => {
    if (route !== 'changements' || changes === null) return;
    const t = seenStamp(changes);
    const prev = getLastSeenAt();
    if (t === null || (prev !== null && Date.parse(prev) >= Date.parse(t))) return;
    setLastSeenAt(t);
    setSeen(t);
  }, [route, changes]);

  const unread = lastSeenAt === null ? 0 : changesModel(changes ?? [], clearedAt, lastSeenAt).unread;
  const data = { promo, schedule, changes, now, retry };
  return (
    <div class="app">
      {route === 'jour' && <Day {...data} />}
      {route === 'semaine' && <Week {...data} />}
      {route === 'changements' && <Changes promo={promo} schedule={schedule} changes={changes} now={now} seenBefore={seenBefore}
        clearedAt={clearedAt} setClearedAt={(v) => { setClearedAt(v); setCleared(v); }} failed={changesError} retry={retry} />}
      {route === 'reglages' && <Settings promo={promo} onPromo={onPromo} />}
      <TabBar route={route} unread={unread} />
    </div>
  );
}

export function App() {
  const route = useRoute();
  const [promo, setPromoState] = useState(getPromo);
  const [skipped, setSkipped] = useState(getNotifsSkipped);
  const [permission, setPermission] = useState(notificationPermission);
  const step = onboardingStep({ standalone: isStandalone(), isIOS: isIOS(), promo, permission, skippedNotifs: skipped });

  if (step === 'install') return <Install />;
  if (step === 'promo') return <Promo initial={promo} onDone={(p) => { setPromo(p); setPromoState(p); }} />;
  if (step === 'notifs') {
    return <Notifs promo={promo!} onResult={setPermission} onSkip={() => { setNotifsSkipped(); setSkipped(true); }} />;
  }
  // A new promo remounts Shell: fresh data, feed state reset, subscription re-posted with the new promo.
  return <Shell key={promo} promo={promo!} route={route}
    onPromo={(p) => { setPromo(p); setClearedAt(null); setLastSeenAt(null); setPromoState(p); }} />;
}
