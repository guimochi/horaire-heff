import { sendNotification } from 'web-push';
import { isAllowedPushEndpoint } from '../shared/push-hosts';
import type { PushSub } from '../shared/types';

// timeout: web-push's socket timeout; without it a stalled push service holds the run until the job is killed.
const webPushSender = (s: PushSub, body: string, ttl: number) => sendNotification(s, body, { TTL: ttl, urgency: 'high', timeout: 10_000 });

// HTTP status from the push service; else a Node socket error (has `code`), web-push's timeout, or web-push's own check (local).
const kind = (e: unknown) => {
  const x = e as { statusCode?: number; code?: unknown; message?: unknown } | null;
  return x?.statusCode ?? (typeof x?.code === 'string' ? 'network' : x?.message === 'Socket timeout' ? 'timeout' : 'local');
};

// Never throws; 404/410 and non-allowlisted endpoints come back in `expired` for deletion. Only 404/410: a 401/403 or a
// local error also comes from our own misconfiguration (e.g. mismatched VAPID keys) and must not delete real subscriptions.
export async function sendAll(subs: { hash: string; subscription: PushSub }[], payload: object, ttl = 43200,
  sender: (s: PushSub, body: string, ttl: number) => Promise<unknown> = webPushSender, deadline?: Date): Promise<{ sent: number; expired: string[] }> {
  const body = JSON.stringify(payload);
  let sent = 0;
  const expired: string[] = [];
  for (const [i, { hash, subscription }] of subs.entries()) {
    if (deadline && Date.now() > deadline.getTime()) { console.log(`push: run deadline, ${subs.length - i} not sent`); break; }
    if (!isAllowedPushEndpoint(subscription.endpoint)) { expired.push(hash); continue; }
    try {
      await sender(subscription, body, ttl);
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number } | null)?.statusCode;
      if (code === 404 || code === 410) expired.push(hash);
      else console.error(`push: send failed (${kind(e)})`); // no endpoint: the error object carries it
    }
  }
  return { sent, expired };
}
