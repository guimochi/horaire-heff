import { isAllowedPushEndpoint } from '../../src/shared/push-hosts';
import type { Change, PushSub, Snapshot } from '../../src/shared/types';

export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number; metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string; cursor?: string }): Promise<{ keys: { name: string; metadata?: unknown }[]; list_complete: boolean; cursor?: string }>;
}
export interface Env { HORAIRE: KV; ADMIN_TOKEN?: string }
/** The slice of the Workers Cache API used (caches.default): throttle counters and the 60 s copy of public GETs. */
export interface CounterCache { match(key: string): Promise<Response | undefined>; put(key: string, res: Response): Promise<void> }

const MAX_BODY = 1_048_576; // admin routes
const MAX_PUBLIC_BODY = 16_384; // a subscribe body is under 1 KiB
const MAX_CHANGES = 50;
const MAX_METADATA = 1024; // KV key metadata limit, bytes
const THROTTLE_PER_HOUR = 10;

class HttpError extends Error { constructor(public status: number) { super(String(status)); } }

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const empty = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

const EDGE_TTL = 60; // seconds
// Public GETs: a 60 s copy in the edge cache spares KV reads (free tier: about 100k a day). The browser still gets no-store.
// `key` is the normalised resource URL: no query string, slash or escape variant ever bypasses the copy. Fails open, like the throttle.
async function edge(key: string, cache: CounterCache | undefined, build: () => Promise<Response>, onHit?: () => Promise<void>) {
  try {
    const hit = await cache?.match(key);
    if (hit) { await onHit?.(); return new Response(hit.body, { status: 200, headers: JSON_HEADERS }); }
  } catch { /* no cache: read KV */ }
  const res = await build();
  if (cache && res.status === 200) {
    try { await cache.put(key, new Response(await res.clone().text(), { headers: { 'cache-control': `max-age=${EDGE_TTL}` } })); } catch { /* fail open */ }
  }
  return res;
}

const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

async function authorized(req: Request, env: Env) {
  if (!env.ADMIN_TOKEN) return false;
  const m = /^Bearer (.*)$/.exec(req.headers.get('authorization') ?? '');
  if (!m) return false;
  const [a, b] = await Promise.all([sha256(m[1]), sha256(env.ADMIN_TOKEN)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function readJson(req: Request, max = MAX_BODY): Promise<any> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > max) throw new HttpError(413);
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel(); throw new HttpError(413); }
      chunks.push(value);
    }
  }
  const buf = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { throw new HttpError(400); }
}

const getJson = async <T>(kv: KV, key: string): Promise<T | null> => {
  const v = await kv.get(key);
  return v === null ? null : (JSON.parse(v) as T);
};

const decode = (s: string) => { try { return decodeURIComponent(s); } catch { throw new HttpError(400); } };
const encode = (s: string) => { try { return encodeURIComponent(s); } catch { throw new HttpError(400); } }; // lone surrogate

async function knownPromo(env: Env, raw: string) {
  const promo = decode(raw);
  const promos = (await getJson<string[]>(env.HORAIRE, 'promos')) ?? [];
  if (!promos.includes(promo)) throw new HttpError(404);
  return promo;
}

const DAY = 86_400_000;
type Watch = { first: string; last: string };
// Writes only when missing or >24h old: caps KV writes at 1 per promo per day. `first` never moves, so later
// (scripted) views can never sort ahead of an existing viewer.
async function recordWatch(kv: KV, promo: string) {
  try {
    const prev = await getJson<Watch>(kv, `watch:${promo}`);
    if (Date.now() - Date.parse(prev?.last ?? '') < DAY) return;
    const now = new Date().toISOString();
    await kv.put(`watch:${promo}`, JSON.stringify({ first: prev?.first ?? now, last: now }), { expirationTtl: 15 * 86400 });
  } catch { /* a KV failure must never break the read */ }
}

// IPv6 by /64 (one host usually owns a whole /64), IPv4 per address.
function ipBucket(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

// shortcut: the Cache API is per colo and not atomic (parallel requests read the same count), so this count is
// approximate; for a real limit, add Turnstile or a custom domain with a WAF rate-limit rule (DEPLOY.md §5).
// Called only for requests that would write, so app re-syncs never spend it.
async function underLimit(req: Request, cache: CounterCache | undefined): Promise<boolean> {
  if (!cache) return true; // no Cache API (tests, local dev): fail open
  try {
    const ip = ipBucket(req.headers.get('cf-connecting-ip') ?? '');
    // One key per IP per clock hour: a put on every hit must not slide the window.
    const key = `${new URL(req.url).origin}/__throttle/${Math.floor(Date.now() / 3_600_000)}/${encodeURIComponent(ip)}`;
    const n = Number((await (await cache.match(key))?.text()) ?? 0) + 1;
    await cache.put(key, new Response(String(n), { headers: { 'cache-control': 'max-age=3600' } }));
    return n <= THROTTLE_PER_HOUR;
  } catch {
    return true;
  }
}

const isList = (b: unknown): b is string[] => Array.isArray(b) && b.every((p) => typeof p === 'string');

const B64URL = /^[A-Za-z0-9_-]+$/;
// p256dh: 65-byte uncompressed P-256 point (0x04 first, so 'B'); auth: 16 bytes. Garbage keys could never be pushed to.
const validKeys = (k: any) => !!k && typeof k.p256dh === 'string' && k.p256dh.length === 87 && k.p256dh[0] === 'B' && B64URL.test(k.p256dh) &&
  typeof k.auth === 'string' && k.auth.length === 22 && B64URL.test(k.auth);
const validSub = (s: any): s is PushSub =>
  !!s && typeof s.endpoint === 'string' && s.endpoint.length < 1024 && isAllowedPushEndpoint(s.endpoint) && validKeys(s.keys);

type SubMeta = { promo: string; subscription: PushSub; at: string /*first subscribe*/; seen: string /*last write*/ };
const SUB_TTL = 90 * 86400; // seconds: a subscription the app stops re-posting ages out
const SUB_REFRESH = 30 * DAY;

// A cross-site "simple" request (text/plain, no preflight) must never reach KV. Requiring JSON forces a preflight,
// which fails: there is no OPTIONS handler and no CORS header.
function sameOriginJson(req: Request) {
  const site = req.headers.get('sec-fetch-site');
  if ((site && site !== 'same-origin') || !(req.headers.get('content-type') ?? '').startsWith('application/json')) throw new HttpError(403);
}

async function route(req: Request, env: Env, cache?: CounterCache): Promise<Response> {
  const kv = env.HORAIRE;
  const { origin, pathname } = new URL(req.url);
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]
  const key = `${req.method} ${parts[1]}`;

  if (parts[0] !== 'api') throw new HttpError(404);

  if (parts[1] === 'admin') {
    if (!(await authorized(req, env))) throw new HttpError(401);
    const n = parts.length;
    switch (`${req.method} ${parts[2]}`) {
      case 'GET subs': {
        if (n !== 3) break;
        const out: { hash: string; promo: string; subscription: PushSub; at: string }[] = [];
        let cursor: string | undefined;
        for (;;) {
          const page = await kv.list({ prefix: 'sub:', cursor });
          for (const { name, metadata } of page.keys) {
            // Metadata comes with list(): no get per subscription.
            const v = metadata as SubMeta | undefined;
            if (v) out.push({ hash: name.slice(4), promo: v.promo, subscription: v.subscription, at: v.at });
          }
          if (page.list_complete) break;
          cursor = page.cursor;
        }
        return json(out);
      }
      case 'DELETE subs':
        if (n !== 4) break;
        await kv.delete('sub:' + decode(parts[3]));
        return empty(204);
      case 'GET state': {
        if (n !== 4) break;
        const promo = await knownPromo(env, parts[3]);
        return json({
          snapshot: await getJson<Snapshot>(kv, `snapshot:${promo}`),
          pending: await getJson<Snapshot>(kv, `pending:${promo}`),
        });
      }
      case 'PUT state': {
        if (n !== 4) break;
        const promo = await knownPromo(env, parts[3]);
        const body = await readJson(req);
        if (!body || typeof body !== 'object') throw new HttpError(400);
        // Feed first, snapshot last: if a later write fails, the old snapshot stays and the next run detects the change
        // again (a duplicate at worst, deduped below) instead of losing it and its push.
        if (Array.isArray(body.newChanges)) {
          const fresh = body.newChanges as Change[];
          // Change ids end with `|<detectedAt>`: the same change found again by a later run has the same base.
          const base = (c: Change) => (c.id.endsWith(`|${c.detectedAt}`) ? c.id.slice(0, -(c.detectedAt.length + 1)) : c.id);
          const ids = new Set(fresh.flatMap((c) => [c.id, base(c)]));
          const old = ((await getJson<Change[]>(kv, `changes:${promo}`)) ?? []).filter((c) => !ids.has(c.id) && !ids.has(base(c)));
          await kv.put(`changes:${promo}`, JSON.stringify([...fresh, ...old].slice(0, MAX_CHANGES)));
        }
        if ('pending' in body) {
          if (body.pending === null) await kv.delete(`pending:${promo}`);
          else await kv.put(`pending:${promo}`, JSON.stringify(body.pending));
        }
        if ('snapshot' in body && body.snapshot !== null) await kv.put(`snapshot:${promo}`, JSON.stringify(body.snapshot));
        return empty(204);
      }
      case 'PUT promos': {
        if (n !== 3) break;
        const body = await readJson(req);
        if (!isList(body)) throw new HttpError(400);
        await kv.put('promos', JSON.stringify(body));
        return empty(204);
      }
      // A refused promo list, kept until the sync job reads it a second time (or the page reads the old one again).
      case 'GET promos-pending':
        if (n !== 3) break;
        return json(await getJson<string[]>(kv, 'promos:pending'));
      case 'PUT promos-pending': {
        if (n !== 3) break;
        const body = await readJson(req);
        if (body === null) await kv.delete('promos:pending');
        else if (isList(body)) await kv.put('promos:pending', JSON.stringify(body));
        else throw new HttpError(400);
        return empty(204);
      }
      case 'GET watched': {
        if (n !== 3) break;
        const promos = (await getJson<string[]>(kv, 'promos')) ?? [];
        const out: ({ promo: string } & Watch)[] = [];
        let cursor: string | undefined;
        for (;;) {
          const page = await kv.list({ prefix: 'watch:', cursor });
          for (const { name } of page.keys) {
            const promo = name.slice(6);
            const w = await getJson<Watch>(kv, name);
            if (w && promos.includes(promo) && Date.now() - Date.parse(w.last) <= 14 * DAY) out.push({ promo, first: w.first, last: w.last });
          }
          if (page.list_complete) break;
          cursor = page.cursor;
        }
        return json(out); // the sync job orders them
      }
      case 'PUT reads': {
        if (n !== 3) break;
        const body = await readJson(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400);
        const promos = (await getJson<string[]>(kv, 'promos')) ?? [];
        for (const [p, at] of Object.entries(body)) {
          if (!promos.includes(p) || typeof at !== 'string' || Number.isNaN(Date.parse(at))) throw new HttpError(400);
        }
        const old = (await getJson<Record<string, string>>(kv, 'meta:reads')) ?? {};
        const merged = { ...old, ...(body as Record<string, string>) };
        if (JSON.stringify(merged) !== JSON.stringify(old)) await kv.put('meta:reads', JSON.stringify(merged));
        return empty(204);
      }
    }
    throw new HttpError(404);
  }

  switch (key) {
    case 'GET promos':
      if (parts.length !== 2) break;
      return edge(`${origin}/api/promos`, cache, async () => json((await getJson<string[]>(kv, 'promos')) ?? []));
    case 'GET schedule':
      if (parts.length !== 3) break;
      // The watch signal runs on a hit too (only 200s are copied, so the promo is known).
      return edge(`${origin}/api/schedule/${encode(decode(parts[2]))}`, cache, async () => {
        const promo = await knownPromo(env, parts[2] ?? '');
        await recordWatch(kv, promo); // even on 404, so the sync job reads it
        const snapshot = await getJson<Snapshot>(kv, `snapshot:${promo}`);
        if (!snapshot) throw new HttpError(404);
        return json({ snapshot, lastSuccess: ((await getJson<Record<string, string>>(kv, 'meta:reads')) ?? {})[promo] ?? null });
      }, () => recordWatch(kv, decode(parts[2])));
    case 'GET changes':
      if (parts.length !== 3) break;
      return edge(`${origin}/api/changes/${encode(decode(parts[2]))}`, cache, async () => {
        const promo = await knownPromo(env, parts[2] ?? '');
        await recordWatch(kv, promo);
        return json((await getJson<Change[]>(kv, `changes:${promo}`)) ?? []);
      }, () => recordWatch(kv, decode(parts[2])));
    case 'POST subscribe': {
      sameOriginJson(req);
      const body = await readJson(req, MAX_PUBLIC_BODY);
      if (typeof body?.promo !== 'string' || !validSub(body.subscription)) throw new HttpError(400);
      await knownPromo(env, encode(body.promo));
      const { endpoint, keys } = body.subscription;
      const hash = hex(await sha256(endpoint));
      const sub = { promo: body.promo, subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } } };
      const old = await getJson<SubMeta>(kv, `sub:${hash}`);
      // KV writes are scarce on the free tier: an unchanged re-POST (every app launch) writes about once a month.
      if (old && JSON.stringify({ promo: old.promo, subscription: old.subscription }) === JSON.stringify(sub) &&
        Date.now() - Date.parse(old.seen) < SUB_REFRESH) return empty(204);
      const now = new Date().toISOString();
      const meta: SubMeta = { ...sub, at: old?.at ?? now, seen: now };
      const value = JSON.stringify(meta);
      // Stored as key metadata too, which must fit in 1024 bytes; real push subscriptions do.
      if (new TextEncoder().encode(value).length > MAX_METADATA) throw new HttpError(400);
      if (!(await underLimit(req, cache))) throw new HttpError(429);
      await kv.put(`sub:${hash}`, value, { expirationTtl: SUB_TTL, metadata: meta });
      return empty(204);
    }
    case 'DELETE subscribe': {
      sameOriginJson(req);
      const body = await readJson(req, MAX_PUBLIC_BODY);
      if (typeof body?.endpoint !== 'string') throw new HttpError(400);
      const k = `sub:${hex(await sha256(body.endpoint))}`;
      if ((await kv.get(k)) === null) return empty(204); // a read is cheap; a delete spends the daily write quota
      if (!(await underLimit(req, cache))) throw new HttpError(429);
      await kv.delete(k);
      return empty(204);
    }
  }
  throw new HttpError(404);
}

export async function handle(req: Request, env: Env, cache?: CounterCache): Promise<Response> {
  try {
    return await route(req, env, cache);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.status }, e.status);
    // Never headers or bodies: the request carries the admin token and subscription keys.
    console.error(`api: ${req.method} ${new URL(req.url).pathname} 500 ${(e as Error)?.message}`);
    return json({ error: 500 }, 500);
  }
}

export const onRequest = (ctx: { request: Request; env: Env }) =>
  handle(ctx.request, ctx.env, (globalThis as { caches?: { default?: CounterCache } }).caches?.default);
