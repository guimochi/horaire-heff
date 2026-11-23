export const PUSH_HOSTS = {
  exact: ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'],
  suffix: ['push.apple.com', 'notify.windows.com'],
};

export function isAllowedPushEndpoint(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const h = u.hostname;
  return PUSH_HOSTS.exact.includes(h) || PUSH_HOSTS.suffix.some((s) => h.endsWith('.' + s));
}
