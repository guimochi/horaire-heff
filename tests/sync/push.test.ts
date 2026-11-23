import { describe, it, expect, vi } from 'vitest';

vi.mock('web-push', () => ({ sendNotification: vi.fn(async () => ({ statusCode: 201 })) }));
import { sendNotification } from 'web-push';
import { sendAll } from '../../src/sync/push';
import type { PushSub } from '../../src/shared/types';

const sub = (n: number, host = 'web.push.apple.com'): PushSub =>
  ({ endpoint: `https://${host}/ep${n}`, keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) } });
const subs = [1, 2, 3].map((n) => ({ hash: `h${n}`, subscription: sub(n) }));
const failing = (n: number, err: unknown) => async (s: PushSub) => {
  if (s.endpoint.endsWith(`ep${n}`)) throw err;
};

describe('sendAll', () => {
  it('expired_subscription_is_reported_not_thrown', async () => {
    expect(await sendAll(subs, { title: 't' }, 43200, failing(2, { statusCode: 410 }))).toStrictEqual({ sent: 2, expired: ['h2'] });
  });
  it('not_found_subscription_is_expired', async () => {
    expect(await sendAll(subs, { title: 't' }, 43200, failing(2, { statusCode: 404 }))).toStrictEqual({ sent: 2, expired: ['h2'] });
  });
  it('server_error_is_neither_sent_nor_expired_and_others_still_go', async () => {
    const sender = vi.fn(failing(1, { statusCode: 500 }));
    expect(await sendAll(subs, {}, 43200, sender)).toStrictEqual({ sent: 2, expired: [] });
    expect(sender).toHaveBeenCalledTimes(3);
  });
  it('network_error_is_neither_sent_nor_expired', async () => {
    expect(await sendAll(subs, {}, 43200, failing(3, Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })))).toStrictEqual({ sent: 2, expired: [] });
  });
  it('errors_are_logged_by_kind_and_only_404_410_expire', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cases: [unknown, string][] = [
      [new Error('The subscription p256dh value should be 65 bytes long.'), 'local'], // web-push's own check: no statusCode, no code
      [Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }), 'network'],
      [new Error('Socket timeout'), 'timeout'],
      [{ statusCode: 401 }, '401'], [{ statusCode: 403 }, '403'],
    ];
    for (const [e, kind] of cases) {
      err.mockClear();
      expect(await sendAll([subs[0]], {}, 43200, failing(1, e))).toStrictEqual({ sent: 0, expired: [] });
      expect(err.mock.calls.map((x) => x.join(' '))).toStrictEqual([`push: send failed (${kind})`]);
    }
    err.mockRestore();
  });
  it('stops_sending_past_the_deadline', async () => {
    const sender = vi.fn(async () => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await sendAll(subs, {}, 43200, sender, new Date(Date.now() - 1))).toStrictEqual({ sent: 0, expired: [] });
    expect(sender).not.toHaveBeenCalled();
    expect(log.mock.calls.map((x) => x.join(' '))).toStrictEqual(['push: run deadline, 3 not sent']);
    expect(await sendAll(subs, {}, 43200, sender, new Date(Date.now() + 60_000))).toStrictEqual({ sent: 3, expired: [] });
    log.mockRestore();
  });
  it('disallowed_endpoint_is_not_sent_and_reported_expired', async () => {
    const sender = vi.fn(async () => {});
    const list = [subs[0], { hash: 'evil', subscription: sub(9, 'attacker.example') }];
    expect(await sendAll(list, {}, 43200, sender)).toStrictEqual({ sent: 1, expired: ['evil'] });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith(subs[0].subscription, '{}', 43200);
  });
  it('payload_is_sent_as_json', async () => {
    const sender = vi.fn(async (_s: PushSub, _b: string) => {});
    const payload = { title: 'T', body: 'B', url: '/#/changements' };
    await sendAll([subs[0]], payload, 43200, sender);
    expect(JSON.parse(sender.mock.calls[0][1])).toStrictEqual(payload);
  });
  it('default_sender_uses_web_push_with_ttl_and_high_urgency', async () => {
    expect(await sendAll([subs[0]], { title: 'T' })).toStrictEqual({ sent: 1, expired: [] });
    expect(sendNotification).toHaveBeenCalledWith(subs[0].subscription, '{"title":"T"}', { TTL: 43200, urgency: 'high', timeout: 10_000 });
  });
  it('ttl_is_passed_to_web_push', async () => {
    await sendAll([subs[0]], { title: 'T' }, 600);
    expect(sendNotification).toHaveBeenLastCalledWith(subs[0].subscription, '{"title":"T"}', { TTL: 600, urgency: 'high', timeout: 10_000 });
  });
});
