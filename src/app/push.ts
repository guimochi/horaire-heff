const VAPID_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '';

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Call only from a click handler: iOS grants the permission prompt to a user gesture only.
// Throws if the browser subscription or the server registration fails, so the caller can offer a retry.
export async function subscribe(promo: string): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || !VAPID_KEY) return 'unsupported';
  // First await, so nothing consumes the gesture before the prompt.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  // `ready` never settles if registration failed: give up so the screen can show its retry message.
  const reg = await Promise.race([navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('subscribe: service worker not ready')), 10_000))]);
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(VAPID_KEY) });
  await postSubscription(promo, sub);
  return 'granted';
}

async function postSubscription(promo: string, sub: PushSubscription): Promise<void> {
  const { endpoint, keys } = sub.toJSON();
  const res = await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ promo, subscription: { endpoint, keys: { p256dh: keys?.p256dh, auth: keys?.auth } } }),
  });
  if (!res.ok) throw new Error(`subscribe: HTTP ${res.status}`);
}

// getRegistration, not `ready`: `ready` never settles when no service worker is registered (dev, blocked).
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

// No user gesture needed: re-registers an existing subscription (server is idempotent), e.g. after a failed first POST or a promo change.
export async function resync(promo: string): Promise<void> {
  const sub = await currentSubscription();
  if (sub) await postSubscription(promo, sub);
}

// The local unsubscribe runs even if the DELETE fails: the server drops the dead endpoint on its next push.
export async function unsubscribe(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch('/api/subscribe', { method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe();
}
