// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resync, unsubscribe } from '../../src/app/push';

const ENDPOINT = 'https://web.push.apple.com/abc';
const KEYS = { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) };
let sub: { endpoint: string; toJSON: () => unknown; unsubscribe: ReturnType<typeof vi.fn> } | null;
const fetchMock = vi.fn();

beforeEach(() => {
  sub = { endpoint: ENDPOINT, toJSON: () => ({ endpoint: ENDPOINT, keys: KEYS }), unsubscribe: vi.fn().mockResolvedValue(true) };
  (window as any).PushManager = function PushManager() {};
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true,
    value: { getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }) } });
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); delete (window as any).PushManager; delete (navigator as any).serviceWorker; });

describe('push helpers (R17 and the Réglages switch)', () => {
  it('resync_posts_existing_subscription_with_promo', async () => {
    await resync('BA3 - S3 - MATH');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/subscribe');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ promo: 'BA3 - S3 - MATH', subscription: { endpoint: ENDPOINT, keys: KEYS } });
    expect(init.headers).toEqual({ 'content-type': 'application/json' }); // the API refuses anything else (403)
  });

  it('resync_without_subscription_does_nothing', async () => {
    sub = null;
    await resync('BA3 - S3 - EPS');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('unsubscribe_deletes_then_unsubscribes_even_if_delete_fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await unsubscribe();
    const [url, init] = fetchMock.mock.calls[0];
    expect([url, init.method, JSON.parse(init.body), init.headers]).toEqual(['/api/subscribe', 'DELETE', { endpoint: ENDPOINT }, { 'content-type': 'application/json' }]);
    expect(sub!.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
