import { describe, it, expect, vi, afterEach } from 'vitest';
import { handle, type CounterCache, type KV } from '../../functions/api/[[route]]';

function fakeKV(pageSize = 1000) {
  const m = new Map<string, string>();
  const meta = new Map<string, unknown>();
  const puts: string[] = [], gets: string[] = [], deletes: string[] = [];
  const opts = new Map<string, { expirationTtl?: number; metadata?: unknown } | undefined>();
  const kv: KV = {
    get: async (k) => { gets.push(k); return m.get(k) ?? null; },
    put: async (k, v, o) => { puts.push(k); m.set(k, v); opts.set(k, o); if (o?.metadata !== undefined) meta.set(k, o.metadata); else meta.delete(k); },
    delete: async (k) => { deletes.push(k); m.delete(k); meta.delete(k); },
    list: async ({ prefix = '', cursor } = {}) => {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = keys.slice(start, start + pageSize);
      const done = start + pageSize >= keys.length;
      return { keys: slice.map((name) => (meta.has(name) ? { name, metadata: meta.get(name) } : { name })), list_complete: done,
        cursor: done ? undefined : String(start + pageSize) };
    },
  };
  return { m, meta, opts, puts, gets, deletes, env: { HORAIRE: kv, ADMIN_TOKEN: 'tok' } };
}
function fakeCache() {
  const m = new Map<string, string>(), cc = new Map<string, string | null>();
  return { m, cc, match: async (k: string) => (m.has(k) ? new Response(m.get(k)) : undefined),
    put: async (k: string, r: Response) => { m.set(k, await r.text()); cc.set(k, r.headers.get('cache-control')); } };
}
type E = ReturnType<typeof fakeKV>['env'];
// The app's fetches send `content-type: application/json`; `headers` overrides (or, set to '', drops) a header.
const call = (env: E, method: string, path: string, body?: unknown, token?: string, raw?: string, cache?: CounterCache, ip = '203.0.113.7',
  headers: Record<string, string> = {}) => {
  const h: Record<string, string> = { 'cf-connecting-ip': ip, ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(raw !== undefined || body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers };
  for (const k of Object.keys(h)) if (h[k] === '') delete h[k];
  return handle(new Request('https://x.test' + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }), env, cache);
};
// Real key shapes: p256dh is a 65-byte P-256 point (87 base64url chars, 'B' first), auth 16 bytes (22 chars).
const P256 = 'B' + 'A'.repeat(86), AUTH = 'A'.repeat(22);
const sub = (endpoint = 'https://fcm.googleapis.com/abc', keys = { p256dh: P256, auth: AUTH }) => ({ promo: 'P 1', subscription: { endpoint, keys } });
const ch = (id: string) => ({ id, kind: 'annule', promo: 'P 1', detectedAt: 'x', before: null, after: null });

afterEach(() => { vi.useRealTimers(); });
const H = 3600_000;

describe('api', () => {
  it('promos_list', async () => {
    const { m, env } = fakeKV();
    expect(await (await call(env, 'GET', '/api/promos')).json()).toEqual([]);
    m.set('promos', JSON.stringify(['P 1']));
    const r = await call(env, 'GET', '/api/promos');
    expect(await r.json()).toEqual(['P 1']);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    const e = await call(env, 'DELETE', '/api/subscribe', { endpoint: 'https://fcm.googleapis.com/none' });
    expect([e.status, e.headers.get('x-content-type-options')]).toEqual([204, 'nosniff']);
    expect((await call(env, 'GET', '/api/nope')).headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('public_gets_use_a_60s_edge_copy', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T09:00:00Z'));
    const { m, gets, puts, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    m.set('snapshot:P 1', JSON.stringify({ promo: 'P 1' }));
    m.set('changes:P 1', JSON.stringify([ch('a')]));
    const cache = fakeCache();
    const get = (path: string, c: CounterCache | undefined = cache) => call(env, 'GET', path, undefined, undefined, undefined, c);
    for (const path of ['/api/promos', '/api/schedule/P%201', '/api/changes/P%201']) {
      const first = await (await get(path)).text();
      expect(cache.cc.get('https://x.test' + path)).toBe('max-age=60');
      gets.length = 0;
      const hit = await get(path + '?bust=1'); // the query never bypasses the copy
      expect(await hit.text()).toBe(first);
      expect([hit.status, hit.headers.get('cache-control'), hit.headers.get('content-type'), hit.headers.get('x-content-type-options')])
        .toEqual([200, 'no-store', 'application/json; charset=utf-8', 'nosniff']);
      expect(gets).toEqual(path === '/api/promos' ? [] : ['watch:P 1']); // the watch signal still runs on a hit
    }
    // Other spellings of the same resource share the copy; extra segments are not a resource.
    gets.length = 0;
    for (const path of ['/api/promos/', '//api/promos', '/api/schedule/%50%201', '/api/schedule/P%201/', '/api/changes/P 1'])
      expect((await get(path)).status, path).toBe(200);
    expect(gets.filter((k) => !k.startsWith('watch:'))).toEqual([]);
    for (const path of ['/api/promos/x', '/api/schedule/P%201/x', '/api/changes/P%201/x/y'])
      expect((await get(path)).status, path).toBe(404);
    expect([...cache.m.keys()].filter((k) => !k.includes('__throttle')).sort())
      .toEqual(['https://x.test/api/changes/P%201', 'https://x.test/api/promos', 'https://x.test/api/schedule/P%201']);
    // The watch write still happens once a day on a hit.
    vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
    const n = puts.filter((k) => k === 'watch:P 1').length;
    await get('/api/schedule/P%201');
    expect(puts.filter((k) => k === 'watch:P 1').length).toBe(n + 1);
    // Only 200s are copied; a broken cache fails open.
    expect((await get('/api/schedule/Nope')).status).toBe(404);
    expect(cache.m.has('https://x.test/api/schedule/Nope')).toBe(false);
    const broken: CounterCache = { match: async () => { throw new Error('no cache'); }, put: async () => { throw new Error('no cache'); } };
    expect((await get('/api/schedule/P%201', broken)).status).toBe(200);
  });

  it('schedule_unknown_promo_404', async () => {
    const { m, env } = fakeKV();
    expect((await call(env, 'GET', '/api/schedule/Nope')).status).toBe(404);
    m.set('promos', JSON.stringify(['P 1']));
    expect((await call(env, 'GET', '/api/schedule/P%201')).status).toBe(404); // no snapshot yet
    expect((await call(env, 'GET', '/api/schedule/%E0%A4%A')).status).toBe(400);
    m.set('snapshot:P 1', JSON.stringify({ promo: 'P 1' }));
    expect(await (await call(env, 'GET', '/api/schedule/P%201')).json()).toEqual({ snapshot: { promo: 'P 1' }, lastSuccess: null });
  });

  it('schedule_records_watch_once_per_day', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T09:00:00Z'));
    const { m, puts, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    await call(env, 'GET', '/api/schedule/P%201');
    vi.setSystemTime(new Date('2026-11-23T20:00:00Z'));
    await call(env, 'GET', '/api/schedule/P%201');
    expect(puts.filter((k) => k === 'watch:P 1')).toHaveLength(1);
    vi.setSystemTime(new Date(Date.parse('2026-11-23T09:00:00Z') + 25 * H));
    await call(env, 'GET', '/api/changes/P%201');
    expect(puts.filter((k) => k === 'watch:P 1')).toHaveLength(2);
    // The first write sets both fields; later writes move only `last`.
    expect(JSON.parse(m.get('watch:P 1')!)).toEqual({ first: '2026-11-23T09:00:00.000Z', last: '2026-11-24T10:00:00.000Z' });
  });

  it('schedule_404_still_records_watch', async () => {
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    expect((await call(env, 'GET', '/api/schedule/P%201')).status).toBe(404);
    expect(m.has('watch:P 1')).toBe(true);
  });

  it('schedule_unknown_promo_records_nothing', async () => {
    const { m, puts, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    expect((await call(env, 'GET', '/api/schedule/Nope')).status).toBe(404);
    expect((await call(env, 'GET', '/api/changes/Nope')).status).toBe(404);
    expect(puts).toEqual([]);
  });

  it('schedule_lastSuccess_is_per_promo_read_or_null', async () => {
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    m.set('snapshot:P 1', JSON.stringify({ promo: 'P 1' }));
    m.set('meta:lastSuccess', 'G'); // legacy global stamp: ignored
    expect((await (await call(env, 'GET', '/api/schedule/P%201')).json() as any).lastSuccess).toBeNull();
    m.set('meta:reads', JSON.stringify({ 'P 1': 'R' }));
    expect((await (await call(env, 'GET', '/api/schedule/P%201')).json() as any).lastSuccess).toBe('R');
  });

  it('admin_watched_lists_recent_only', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T09:00:00Z'));
    const { m, env } = fakeKV(1); // page size 1 exercises the cursor
    m.set('promos', JSON.stringify(['P 1', 'P 2', 'P 3']));
    const ago = (d: number) => new Date(Date.now() - d * 24 * H).toISOString();
    const w = (first: number, last: number) => JSON.stringify({ first: ago(first), last: ago(last) });
    m.set('watch:P 1', w(30, 3)); m.set('watch:P 2', w(20, 20)); m.set('watch:P 3', w(5, 1)); m.set('watch:Gone', w(1, 1));
    expect((await call(env, 'GET', '/api/admin/watched')).status).toBe(401);
    // Kept while `last` is <= 14 days old; `first` is passed on for the sync job's ordering.
    expect(await (await call(env, 'GET', '/api/admin/watched', undefined, 'tok')).json()).toEqual([
      { promo: 'P 1', first: ago(30), last: ago(3) }, { promo: 'P 3', first: ago(5), last: ago(1) }]);
  });

  it('admin_reads_requires_token_validates_and_merges', async () => {
    const { m, puts, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1', 'P 2']));
    const at = '2026-11-23T09:00:00.000Z';
    expect((await call(env, 'PUT', '/api/admin/reads', { 'P 1': at })).status).toBe(401);
    expect((await call(env, 'PUT', '/api/admin/reads', { Nope: at }, 'tok')).status).toBe(400);
    expect((await call(env, 'PUT', '/api/admin/reads', { 'P 1': 'nope' }, 'tok')).status).toBe(400);
    expect((await call(env, 'PUT', '/api/admin/reads', [at], 'tok')).status).toBe(400);
    expect(m.has('meta:reads')).toBe(false);
    expect((await call(env, 'PUT', '/api/admin/reads', { 'P 1': at }, 'tok')).status).toBe(204);
    expect((await call(env, 'PUT', '/api/admin/reads', { 'P 2': at }, 'tok')).status).toBe(204);
    expect(JSON.parse(m.get('meta:reads')!)).toEqual({ 'P 1': at, 'P 2': at });
    const n = puts.length;
    await call(env, 'PUT', '/api/admin/reads', { 'P 1': at }, 'tok');
    expect(puts.length).toBe(n); // unchanged: no write
  });

  it('watch_write_failure_still_serves_schedule', async () => {
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    m.set('snapshot:P 1', JSON.stringify({ promo: 'P 1' }));
    const real = env.HORAIRE.put;
    env.HORAIRE.put = async (k, v, o) => { if (k.startsWith('watch:')) throw new Error('kv down'); return real(k, v, o); };
    expect((await call(env, 'GET', '/api/schedule/P%201')).status).toBe(200);
    expect((await call(env, 'GET', '/api/changes/P%201')).status).toBe(200);
  });

  it('watch_key_has_ttl', async () => {
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    let ttl: number | undefined;
    const real = env.HORAIRE.put;
    env.HORAIRE.put = async (k, v, o) => { if (k.startsWith('watch:')) ttl = o?.expirationTtl; return real(k, v, o); };
    await call(env, 'GET', '/api/changes/P%201');
    expect(ttl).toBe(15 * 86400);
  });

  it('subscribe_stores_and_dedups_same_endpoint', async () => {
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    expect((await call(env, 'POST', '/api/subscribe', sub())).status).toBe(204);
    expect((await call(env, 'POST', '/api/subscribe', sub())).status).toBe(204);
    expect([...m.keys()].filter((k) => k.startsWith('sub:'))).toHaveLength(1);
    expect((await call(env, 'DELETE', '/api/subscribe', { endpoint: 'https://fcm.googleapis.com/abc' })).status).toBe(204);
    expect([...m.keys()].filter((k) => k.startsWith('sub:'))).toHaveLength(0);
  });

  it('subscribe_rejects_http_endpoint_400', async () => {
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    expect((await call(env, 'POST', '/api/subscribe', sub('http://push.example/abc'))).status).toBe(400);
    expect((await call(env, 'POST', '/api/subscribe', sub('https://fcm.googleapis.com/' + 'a'.repeat(1100)))).status).toBe(400);
    expect((await call(env, 'POST', '/api/subscribe', sub(undefined, { p256dh: '', auth: AUTH }))).status).toBe(400);
    expect((await call(env, 'POST', '/api/subscribe', undefined, undefined, '{nope')).status).toBe(400);
    expect((await call(env, 'POST', '/api/subscribe', undefined, undefined, 'x'.repeat(16_385))).status).toBe(413);
  });

  it('subscribe_same_value_does_not_write', async () => {
    const { m, puts, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    await call(env, 'POST', '/api/subscribe', sub());
    await call(env, 'POST', '/api/subscribe', sub());
    expect(puts).toHaveLength(1);
    await call(env, 'POST', '/api/subscribe', sub(undefined, { p256dh: 'B' + 'z'.repeat(86), auth: AUTH }));
    expect(puts).toHaveLength(2);
  });

  it('subscribe_rejects_non_push_host_400', async () => {
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    for (const e of ['https://evil.example', 'https://user:pw@web.push.apple.com/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com:8443/x', 'https://notify.windows.com.evil.example/x'])
      expect((await call(env, 'POST', '/api/subscribe', sub(e))).status, e).toBe(400);
  });

  it('subscribe_accepts_apple_and_fcm', async () => {
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    for (const e of ['https://web.push.apple.com/x', 'https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/x', 'https://abc.notify.windows.com/x', 'https://fcm.googleapis.com:443/x'])
      expect((await call(env, 'POST', '/api/subscribe', sub(e))).status, e).toBe(204);
  });

  it('subscribe_rejects_unknown_promo_404', async () => {
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    expect((await call(env, 'POST', '/api/subscribe', { ...sub(), promo: 'Other' })).status).toBe(404);
  });

  it('admin_requires_token_401', async () => {
    const { env } = fakeKV();
    expect((await call(env, 'GET', '/api/admin/subs')).status).toBe(401);
    expect((await call(env, 'GET', '/api/admin/subs', undefined, 'wrong')).status).toBe(401);
    expect((await call(env, 'GET', '/api/admin/subs', undefined, 'tok')).status).toBe(200);
    expect((await call({ ...env, ADMIN_TOKEN: '' }, 'GET', '/api/admin/subs', undefined, '')).status).toBe(401);
    expect((await call({ HORAIRE: env.HORAIRE } as any, 'GET', '/api/admin/subs', undefined, 'undefined')).status).toBe(401);
  });

  it('admin_state_put_prepends_changes_and_caps_50', async () => {
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    m.set('pending:P 1', '{"a":1}');
    const first = Array.from({ length: 40 }, (_, i) => ch(`a${i}`));
    expect((await call(env, 'PUT', '/api/admin/state/P%201', { snapshot: { s: 1 }, newChanges: first }, 'tok')).status).toBe(204);
    expect(m.has('pending:P 1')).toBe(true); // untouched
    const second = [...Array.from({ length: 20 }, (_, i) => ch(`b${i}`)), ch('a0')];
    await call(env, 'PUT', '/api/admin/state/P%201', { pending: null, newChanges: second }, 'tok');
    expect(m.has('pending:P 1')).toBe(false);
    const list = JSON.parse(m.get('changes:P 1')!);
    expect(list).toHaveLength(50);
    expect(list[0].id).toBe('b0');
    expect(new Set(list.map((c: any) => c.id)).size).toBe(50);
    const g = await (await call(env, 'GET', '/api/admin/state/P%201', undefined, 'tok')).json();
    expect(g).toEqual({ snapshot: { s: 1 }, pending: null });
    expect((await call(env, 'GET', '/api/changes/P%201')).status).toBe(200);
    expect((await call(env, 'PUT', '/api/admin/state/Nope', {}, 'tok')).status).toBe(404);
  });

  it('admin_promos_pending_roundtrip', async () => {
    const { m, env } = fakeKV();
    expect((await call(env, 'GET', '/api/admin/promos-pending')).status).toBe(401);
    expect(await (await call(env, 'GET', '/api/admin/promos-pending', undefined, 'tok')).json()).toBeNull();
    expect((await call(env, 'PUT', '/api/admin/promos-pending', [1], 'tok')).status).toBe(400);
    expect((await call(env, 'PUT', '/api/admin/promos-pending', ['A', 'B'], 'tok')).status).toBe(204);
    expect(await (await call(env, 'GET', '/api/admin/promos-pending', undefined, 'tok')).json()).toEqual(['A', 'B']);
    expect((await call(env, 'PUT', '/api/admin/promos-pending', null, 'tok')).status).toBe(204);
    expect(m.has('promos:pending')).toBe(false);
  });

  it('partial_failure_after_changes_redetects_without_duplicate', async () => {
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    m.set('pending:P 1', '{"p":1}');
    const order: string[] = [];
    const real = env.HORAIRE;
    let snapshotFails = true;
    env.HORAIRE = { ...real,
      put: async (k, v, o) => { order.push(`put ${k}`); if (k.startsWith('snapshot:') && snapshotFails) throw new Error('quota'); return real.put(k, v, o); },
      delete: async (k) => { order.push(`delete ${k}`); return real.delete(k); } };
    const old = { ...ch('local|2026-11-24|Maths||08:00|2026-11-23T08:00:00.000Z'), detectedAt: '2026-11-23T08:00:00.000Z' };
    m.set('changes:P 1', JSON.stringify([old, ch('a0')]));
    const run1 = { ...ch('annule|2026-11-24|Maths||10:00|2026-11-23T09:00:00.000Z'), detectedAt: '2026-11-23T09:00:00.000Z' };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call(env, 'PUT', '/api/admin/state/P%201', { snapshot: { s: 1 }, pending: null, newChanges: [run1] }, 'tok')).status).toBe(500);
    err.mockRestore();
    // Feed first, snapshot last: a failure leaves the old snapshot, so the next run finds the change again.
    expect(order).toEqual(['put changes:P 1', 'delete pending:P 1', 'put snapshot:P 1']);
    expect(m.has('snapshot:P 1')).toBe(false);
    snapshotFails = false;
    const run2 = { ...ch('annule|2026-11-24|Maths||10:00|2026-11-23T09:30:00.000Z'), detectedAt: '2026-11-23T09:30:00.000Z' };
    expect((await call(env, 'PUT', '/api/admin/state/P%201', { snapshot: { s: 1 }, newChanges: [run2] }, 'tok')).status).toBe(204);
    expect(JSON.parse(m.get('changes:P 1')!).map((c: any) => c.id)).toEqual([run2.id, old.id, 'a0']);
  });

  it('admin_subs_lists_all', async () => {
    const { m, env } = fakeKV(2);
    m.set('promos', JSON.stringify(['P 1']));
    for (let i = 0; i < 5; i++) await call(env, 'POST', '/api/subscribe', sub('https://fcm.googleapis.com/' + i));
    const r = (await (await call(env, 'GET', '/api/admin/subs', undefined, 'tok')).json()) as any[];
    expect(r).toHaveLength(5);
    expect(r[0]).toHaveProperty('hash');
    expect((await call(env, 'DELETE', '/api/admin/subs/' + r[0].hash, undefined, 'tok')).status).toBe(204);
    expect([...m.keys()].filter((k) => k.startsWith('sub:'))).toHaveLength(4);
    expect((await call(env, 'PUT', '/api/admin/promos', ['A'], 'tok')).status).toBe(204);
    expect(m.get('promos')).toBe('["A"]');
    expect((await call(env, 'PUT', '/api/admin/last-success', { at: 'T' }, 'tok')).status).toBe(404); // route removed
  });

  it('admin_subs_uses_list_metadata_only', async () => {
    const { m, gets, env } = fakeKV(2);
    m.set('promos', JSON.stringify(['P 1']));
    for (let i = 0; i < 5; i++) await call(env, 'POST', '/api/subscribe', sub('https://fcm.googleapis.com/' + i));
    gets.length = 0;
    const r = (await (await call(env, 'GET', '/api/admin/subs', undefined, 'tok')).json()) as any[];
    expect(r).toHaveLength(5);
    expect(r[0]).toMatchObject({ promo: 'P 1', subscription: { keys: { p256dh: P256, auth: AUTH } } });
    expect(typeof r[0].at).toBe('string');
    expect(gets).toEqual([]);
    // A key without metadata is skipped, never read.
    m.set('sub:legacy', JSON.stringify(sub('https://fcm.googleapis.com/old')));
    expect((await (await call(env, 'GET', '/api/admin/subs', undefined, 'tok')).json()) as any[]).toHaveLength(5);
    expect(gets).toEqual([]);
  });

  it('subscribe_rejects_oversized_metadata_400', async () => {
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    // Endpoint under 1024 chars, but endpoint + keys + promo + at + seen overflow the 1024-byte metadata.
    expect((await call(env, 'POST', '/api/subscribe', sub('https://fcm.googleapis.com/' + 'a'.repeat(900)))).status).toBe(400);
    expect([...m.keys()].filter((k) => k.startsWith('sub:'))).toHaveLength(0);
  });

  it('subscribe_throttled_after_10_writes_per_hour', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T09:10:00Z'));
    const { m, puts, deletes, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    const cache = fakeCache();
    const post = (e: string, ip?: string) => call(env, 'POST', '/api/subscribe', sub('https://fcm.googleapis.com/' + e), undefined, undefined, cache, ip);
    for (let i = 0; i < 10; i++) expect((await post(`e${i}`)).status).toBe(204);
    const n = puts.length;
    expect((await post('new')).status).toBe(429);
    expect((await call(env, 'DELETE', '/api/subscribe', { endpoint: 'https://fcm.googleapis.com/e0' }, undefined, undefined, cache)).status).toBe(429);
    expect(puts.length).toBe(n);
    expect(deletes).toEqual([]);
    expect((await post('e0', '198.51.100.1')).status).toBe(204); // other IP
    vi.setSystemTime(new Date('2026-11-23T10:00:00Z')); // next hour
    expect((await post('new')).status).toBe(204);
    // Throttle errors fail open.
    const broken: CounterCache = { match: async () => { throw new Error('no cache'); }, put: async () => {} };
    expect((await call(env, 'POST', '/api/subscribe', sub('https://fcm.googleapis.com/x'), undefined, undefined, broken)).status).toBe(204);
  });

  it('throttle_counts_only_writes', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T09:10:00Z'));
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    const cache = fakeCache();
    expect((await call(env, 'POST', '/api/subscribe', sub(), undefined, undefined, cache)).status).toBe(204);
    // App launches re-POST the same subscription, and unknown endpoints are DELETEd: neither writes, neither counts.
    for (let i = 0; i < 20; i++) {
      expect((await call(env, 'POST', '/api/subscribe', sub(), undefined, undefined, cache)).status).toBe(204);
      expect((await call(env, 'DELETE', '/api/subscribe', { endpoint: `https://fcm.googleapis.com/u${i}` }, undefined, undefined, cache)).status).toBe(204);
    }
    for (let i = 0; i < 9; i++) expect((await call(env, 'POST', '/api/subscribe', sub(`https://fcm.googleapis.com/n${i}`), undefined, undefined, cache)).status).toBe(204);
    expect((await call(env, 'POST', '/api/subscribe', sub('https://fcm.googleapis.com/last'), undefined, undefined, cache)).status).toBe(429);
  });

  it('throttle_buckets_ipv6_by_64', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T09:10:00Z'));
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    const cache = fakeCache();
    const post = (e: string, ip: string) => call(env, 'POST', '/api/subscribe', sub('https://fcm.googleapis.com/' + e), undefined, undefined, cache, ip);
    for (let i = 0; i < 10; i++) expect((await post(`a${i}`, '2001:db8::1')).status).toBe(204);
    expect((await post('b', '2001:db8::2')).status).toBe(429); // same /64
    expect((await post('c', '2001:0DB8:0:0:ffff::9')).status).toBe(429); // same /64, uncompressed spelling
    expect((await post('d', '2001:db8:0:1::1')).status).toBe(204); // next /64
    expect((await post('e', '203.0.113.8')).status).toBe(204); // IPv4 stays per address
  });

  it('delete_unknown_endpoint_does_not_call_kv_delete', async () => {
    const { m, deletes, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    expect((await call(env, 'DELETE', '/api/subscribe', { endpoint: 'https://fcm.googleapis.com/nope' })).status).toBe(204);
    expect(deletes).toEqual([]);
    await call(env, 'POST', '/api/subscribe', sub());
    expect((await call(env, 'DELETE', '/api/subscribe', { endpoint: 'https://fcm.googleapis.com/abc' })).status).toBe(204);
    expect(deletes).toHaveLength(1);
  });

  it('subscribe_rejects_bad_key_shape_400', async () => {
    const { m, puts, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    for (const keys of [
      { p256dh: 'B' + 'A'.repeat(85), auth: AUTH }, { p256dh: 'B' + 'A'.repeat(87), auth: AUTH }, { p256dh: 'A'.repeat(87), auth: AUTH },
      { p256dh: 'B' + 'A'.repeat(85) + '+', auth: AUTH }, { p256dh: 'B' + 'A'.repeat(85) + '=', auth: AUTH },
      { p256dh: P256, auth: 'A'.repeat(21) }, { p256dh: P256, auth: 'A'.repeat(23) }, { p256dh: P256, auth: 'A'.repeat(21) + '/' },
      { p256dh: P256 }, { p256dh: 1, auth: AUTH },
    ]) expect((await call(env, 'POST', '/api/subscribe', sub(undefined, keys as any))).status, JSON.stringify(keys)).toBe(400);
    expect(puts).toEqual([]);
    expect((await call(env, 'POST', '/api/subscribe', sub(undefined, { p256dh: 'B' + '-_9z'.repeat(21) + 'Aa', auth: '-_'.repeat(11) }))).status).toBe(204);
  });

  it('subscribe_expires_keeps_at_and_rewrites_only_after_30_days', async () => {
    vi.useFakeTimers();
    const T0 = Date.parse('2026-11-23T09:00:00Z');
    vi.setSystemTime(T0);
    const { m, opts, puts, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1', 'P 2']));
    const at = new Date(T0).toISOString();
    expect((await call(env, 'POST', '/api/subscribe', sub())).status).toBe(204);
    const [k] = [...m.keys()].filter((x) => x.startsWith('sub:'));
    expect(opts.get(k)).toEqual({ expirationTtl: 90 * 86400, metadata: { ...sub(), at, seen: at } });
    vi.setSystemTime(T0 + 29 * 24 * H);
    expect((await call(env, 'POST', '/api/subscribe', sub())).status).toBe(204);
    expect(puts).toHaveLength(1); // identical within 30 days: no write
    vi.setSystemTime(T0 + 31 * 24 * H);
    await call(env, 'POST', '/api/subscribe', sub());
    expect(puts).toHaveLength(2);
    expect(opts.get(k)!.metadata).toEqual({ ...sub(), at, seen: new Date(T0 + 31 * 24 * H).toISOString() });
    vi.setSystemTime(T0 + 32 * 24 * H);
    await call(env, 'POST', '/api/subscribe', { ...sub(), promo: 'P 2' }); // promo changed: rewritten at once, `at` kept
    expect(puts).toHaveLength(3);
    expect(opts.get(k)!.metadata).toMatchObject({ promo: 'P 2', at });
  });

  it('subscribe_cross_site_or_non_json_403', async () => {
    const { m, puts, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    for (const [method, body] of [['POST', sub()], ['DELETE', { endpoint: 'https://fcm.googleapis.com/abc' }]] as const) {
      for (const h of [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'none' },
        { 'content-type': 'text/plain' }, { 'content-type': '' }, { 'content-type': 'application/x-www-form-urlencoded' }] as Record<string, string>[])
        expect((await call(env, method, '/api/subscribe', body, undefined, undefined, undefined, undefined, h)).status, `${method} ${JSON.stringify(h)}`).toBe(403);
    }
    expect(puts).toEqual([]);
    expect((await call(env, 'POST', '/api/subscribe', sub(), undefined, undefined, undefined, undefined, { 'sec-fetch-site': 'same-origin' })).status).toBe(204);
    // Admin routes are unchanged: the sync job's Node fetch sends neither header.
    expect((await call(env, 'PUT', '/api/admin/promos', ['P 1'], 'tok', undefined, undefined, undefined, { 'content-type': 'text/plain' })).status).toBe(204);
  });

  it('public_body_capped_at_16k_admin_at_1m', async () => {
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    expect((await call(env, 'DELETE', '/api/subscribe', undefined, undefined, JSON.stringify({ endpoint: 'x'.repeat(16_400) }))).status).toBe(413);
    expect((await call(env, 'PUT', '/api/admin/promos', Array.from({ length: 5000 }, (_, i) => `Promo ${i}`), 'tok')).status).toBe(204); // ~60 KiB
    expect((await call(env, 'PUT', '/api/admin/promos', undefined, 'tok', 'x'.repeat(1_048_577))).status).toBe(413);
  });

  it('malformed_promo_is_400_never_500', async () => {
    const { m, env } = fakeKV();
    m.set('promos', JSON.stringify(['P 1']));
    expect((await call(env, 'POST', '/api/subscribe', { ...sub(), promo: '\ud800' })).status).toBe(400);
    expect((await call(env, 'POST', '/api/subscribe', undefined, undefined, '{"promo":"\\udfff","subscription":' + JSON.stringify(sub().subscription) + '}')).status).toBe(400);
    expect((await call(env, 'GET', '/api/schedule/%ED%A0%80')).status).toBe(400);
    expect((await call(env, 'GET', '/api/changes/%')).status).toBe(400);
    expect((await call(env, 'GET', '/api/admin/state/%E0%A4%A', undefined, 'tok')).status).toBe(400);
  });

  it('unexpected_error_logs_method_path_status_and_message_only', async () => {
    const { env } = fakeKV();
    env.HORAIRE.get = env.HORAIRE.put = async () => { throw new Error('kv boom'); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await call(env, 'PUT', '/api/admin/promos', ['SECRET-BODY'], 'tok');
    expect(r.status).toBe(500);
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0].join(' ')).toBe('api: PUT /api/admin/promos 500 kv boom');
    err.mockClear();
    expect((await call(env, 'GET', '/api/schedule/Nope')).status).toBe(500);
    expect(err.mock.calls[0].join(' ')).not.toMatch(/tok|SECRET|203\.0\.113/);
    err.mockRestore();
  });
});
