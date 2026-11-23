import { Icon } from './Icon';

type Tab = 'jour' | 'semaine' | 'changements';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'jour', label: 'Jour', icon: 'day' },
  { id: 'semaine', label: 'Semaine', icon: 'week' },
  { id: 'changements', label: 'Changements', icon: 'bell' },
];

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
