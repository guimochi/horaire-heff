// localStorage can throw (private mode, blocked storage): reads fall back to null, writes are dropped.
function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string | null): void {
  try { v === null ? localStorage.removeItem(key) : localStorage.setItem(key, v); } catch { /* storage unavailable */ }
}

export const getPromo = () => read('horaire.promo');
export const setPromo = (p: string) => write('horaire.promo', p);
export const getClearedAt = () => read('horaire.clearedAt');
export const setClearedAt = (v: string | null) => write('horaire.clearedAt', v);
export const getLastSeenAt = () => read('horaire.lastSeenAt');
export const setLastSeenAt = (v: string | null) => write('horaire.lastSeenAt', v);
export const getNotifsSkipped = () => read('horaire.notifsSkipped') === '1';
export const setNotifsSkipped = () => write('horaire.notifsSkipped', '1');

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

// iPadOS reports a Mac user agent; touch points tell them apart.
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator ? Notification.permission : 'unsupported';
}

export type OnboardingStep = 'install' | 'promo' | 'notifs' | 'done';

export function onboardingStep(o: { standalone: boolean; isIOS: boolean; promo: string | null;
  permission: NotificationPermission | 'unsupported'; skippedNotifs: boolean }): OnboardingStep {
  // iOS keeps Safari and home-screen storage apart, so the promo is chosen only once installed.
  if (o.isIOS && !o.standalone) return 'install';
  if (!o.promo) return 'promo';
  if (o.permission === 'default' && !o.skippedNotifs) return 'notifs';
  return 'done';
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function searchPromos(all: string[], query: string): string[] {
  const words = norm(query).split(' ').filter(Boolean);
  return all.filter((p) => { const n = norm(p); return words.every((w) => n.includes(w)); });
}

export const promoLabel = (p: string) => p.replace(/ - /g, ' · ');
