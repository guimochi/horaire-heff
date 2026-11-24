import { Icon } from './Icon';

type Tab = 'jour' | 'semaine' | 'changements';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'jour', label: 'Jour', icon: 'day' },
  { id: 'semaine', label: 'Semaine', icon: 'week' },
  { id: 'changements', label: 'Changements', icon: 'bell' },
];

// A mostly horizontal swipe of 60px or more moves to the neighbouring tab (left = next). Réglages is not a tab: no swipe there.
export function swipeTarget(route: string, dx: number, dy: number): Tab | null {
  const i = TABS.findIndex((t) => t.id === route);
  if (i < 0 || Math.abs(dx) < 60 || Math.abs(dx) < 1.5 * Math.abs(dy)) return null;
  return TABS[i + (dx < 0 ? 1 : -1)]?.id ?? null;
}

// Slide direction when moving between tabs; null when Réglages is on either side.
export function slideDir(from: string, to: string): 'next' | 'prev' | null {
  const a = TABS.findIndex((t) => t.id === from), b = TABS.findIndex((t) => t.id === to);
  return a < 0 || b < 0 || a === b ? null : b > a ? 'next' : 'prev';
}

export function TabBar({ route, unread }: { route: string; unread: number }) {
  return (
    <nav class="tabbar" aria-label="Navigation principale">
      {TABS.map((t) => (
        <a key={t.id} href={`#/${t.id}`} aria-current={route === t.id ? 'page' : undefined}>
          <Icon name={t.icon} />{t.label}
          {t.id === 'changements' && unread > 0 && route !== 'changements' && (
            <><span class="tab-badge" aria-hidden="true">{unread}</span><span class="sr-only">{unread === 1 ? '1 non lu' : `${unread} non lus`}</span></>
          )}
        </a>
      ))}
    </nav>
  );
}
