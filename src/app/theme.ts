import { read, write } from './store';

export type Theme = 'auto' | 'clair' | 'sombre';
const KEY = 'horaire.theme';
const COLOR = { clair: '#F5F4F0', sombre: '#121316' } as const;

export function getTheme(): Theme {
  const v = read(KEY);
  return v === 'clair' || v === 'sombre' ? v : 'auto';
}

// public/theme.js does the same before first paint; this keeps it in sync after a change in Réglages.
export function setTheme(t: Theme): void {
  write(KEY, t === 'auto' ? null : t);
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    m.content = t !== 'auto' ? COLOR[t] : (m.getAttribute('media') ?? '').includes('dark') ? COLOR.sombre : COLOR.clair;
  }
}
