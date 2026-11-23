import { afterEach, describe, it, expect, vi } from 'vitest';
import { browserEnv, runOnce } from '../../src/sync/main';
import type { ApiClient } from '../../src/sync/api-client';
import type { Course, PushSub, Snapshot } from '../../src/shared/types';

const IN = new Date('2026-11-23T09:00:00Z'); // Monday 10:00 Brussels
const MORNING = new Date('2026-11-23T05:10:00Z'); // Monday 06:10 Brussels
const OUT = new Date('2026-11-22T12:00:00Z'); // Sunday
const W = ['2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14'];

const c = (date: string, start: string, room = 'R1', subject = 'Maths'): Course =>
  ({ date, start, end: `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:00`, subject,
    teacher: 'T', room, group: '', cancelled: false, extra: [] });
const six = (): Course[] => ['08', '09', '10'].flatMap((h) => [c('2026-11-24', `${h}:00`), c('2026-12-01', `${h}:00`)]);
const snap = (promo: string, courses: Course[], fetchedAt = '2026-11-23T08:30:00.000Z', weeks = W): Snapshot =>
  ({ promo, fetchedAt, weeks, courses });
const KEYS = { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) };
const sub = (hash: string, promo: string, at = '2026-11-01T00:00:00.000Z') =>
  ({ hash, promo, at, subscription: { endpoint: `https://web.push.apple.com/${hash}`, keys: KEYS } as PushSub });

type State = { snapshot: Snapshot | null; pending: Snapshot | null };
function fakeApi(init: { promos?: string[]; subs?: ReturnType<typeof sub>[]; state?: Record<string, State>; watched?: string[]; promosPending?: string[]; watchedThrows?: boolean; putReadsThrows?: boolean; subsThrows?: boolean } = {}) {
  let promos = init.promos ?? ['A', 'B'];
  let promosPending = init.promosPending ?? null;
  const subs = init.subs ?? [];
  const state = new Map(Object.entries(init.state ?? {}));
  const calls: [string, ...unknown[]][] = [];
  const api: ApiClient = {
    getPromos: async () => { calls.push(['getPromos']); return [...promos]; },
    putPromos: async (p) => { calls.push(['putPromos', p]); promos = p; },
    getPromosPending: async () => { calls.push(['getPromosPending']); return promosPending; },
    putPromosPending: async (p) => { calls.push(['putPromosPending', p]); promosPending = p; },
    getState: async (p) => {
      calls.push(['getState', p]);
      if (!promos.includes(p)) throw new Error('API GET state 404');
      return state.get(p) ?? { snapshot: null, pending: null };
    },
    putState: async (p, body) => {
      calls.push(['putState', p, body]);
      const s = { ...(state.get(p) ?? { snapshot: null, pending: null }) };
      if (body.snapshot) s.snapshot = body.snapshot;
      if ('pending' in body) s.pending = body.pending ?? null;
      state.set(p, s);
    },
    getSubs: async () => { calls.push(['getSubs']); if (init.subsThrows) throw new Error('subs down'); return subs; },
    deleteSub: async (h) => { calls.push(['deleteSub', h]); },
    getWatched: async () => {
      calls.push(['getWatched']);
      if (init.watchedThrows) throw new Error('watched down');
      // Listed oldest viewer first; `last` all recent.
      return (init.watched ?? []).map((promo, i) => ({ promo, first: `2026-11-${String(i + 1).padStart(2, '0')}T08:00:00.000Z`, last: '2026-11-23T08:00:00.000Z' }));
    },
    putReads: async (r) => { calls.push(['putReads', r]); if (init.putReadsThrows) throw new Error('reads down'); },
  };
  const named = (n: string) => calls.filter((x) => x[0] === n);
  return { api, calls, named, state };
}

type Read = { courses: Course[]; weeks: string[] } | Error;
function deps(api: ApiClient, reads: Record<string, Read>, now = IN, opts: { list?: () => Promise<string[]>; expired?: string[] } = {}) {
  const scrape = vi.fn(async (promo: string, _weeks: string[]) => {
    const r = reads[promo];
    if (r instanceof Error) throw r;
    return structuredClone(r);
  });
  const scrapeList = vi.fn(opts.list ?? (async () => ['A', 'B']));
  const push = vi.fn(async (_s: { hash: string; subscription: PushSub }[], _p: object, _ttl?: number) => ({ sent: 0, expired: opts.expired ?? [] }));
  return { now, api, scrape, scrapeList, push };
}

describe('runOnce', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('outside_window_does_nothing', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A')] });
    const d = deps(f.api, { A: { courses: six(), weeks: W } }, OUT);
    expect(await runOnce(d)).toStrictEqual({ promos: 0, changes: 0, failed: [], skipped: [] });
    expect(f.calls).toStrictEqual([]);
    expect(d.scrape).not.toHaveBeenCalled();
    expect(d.scrapeList).not.toHaveBeenCalled();
  });

  it('watched_promo_without_subscribers_is_read', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A')], watched: ['B', 'A', 'Gone'] });
    const d = deps(f.api, { A: { courses: six(), weeks: W }, B: { courses: six(), weeks: W } });
    const res = await runOnce(d);
    expect(res.promos).toBe(2);
    expect(f.state.get('B')?.snapshot).not.toBeNull();
    expect(f.named('putReads')).toStrictEqual([['putReads', { A: IN.toISOString(), B: IN.toISOString() }]]);
    expect(d.push).not.toHaveBeenCalled();
  });

  it('watched_only_promos_capped_at_12', async () => {
    const names = Array.from({ length: 15 }, (_, i) => `W${String(i).padStart(2, '0')}`);
    const f = fakeApi({ promos: ['S', ...names], subs: [sub('h1', 'S')], watched: names });
    const reads: Record<string, Read> = { S: { courses: six(), weeks: W } };
    for (const n of names) reads[n] = { courses: six(), weeks: W };
    const d = deps(f.api, reads, IN, { list: async () => ['S', ...names] });
    const res = await runOnce(d);
    const scraped = d.scrape.mock.calls.map((x) => x[0]);
    expect(scraped).toHaveLength(13); // subscriber promo + the 12 oldest viewers
    expect(scraped).toContain('S');
    expect(scraped).toContain(names[11]);
    expect(scraped).not.toContain(names[12]);
    expect(res.skipped).toStrictEqual(names.slice(12));
  });

  it('watched_only_ordered_by_first_view_not_last', async () => {
    const f = fakeApi({ promos: ['Old', 'New'] });
    f.api.getWatched = async () => [
      { promo: 'New', first: '2026-11-22T08:00:00.000Z', last: '2026-11-23T08:59:00.000Z' }, // refreshed most recently
      { promo: 'Old', first: '2026-11-02T08:00:00.000Z', last: '2026-11-23T07:00:00.000Z' }];
    const d = deps(f.api, { Old: { courses: six(), weeks: W }, New: { courses: six(), weeks: W } });
    await runOnce(d);
    expect(d.scrape.mock.calls.map((x) => x[0])).toStrictEqual(['Old', 'New']);
  });

  it('subscribed_promos_capped_at_20_by_oldest_subscription', async () => {
    const names = Array.from({ length: 22 }, (_, i) => `S${String(i).padStart(2, '0')}`);
    // Newest subscription first in the list: the order comes from `at`, not from the list.
    const subs = names.map((n, i) => sub(`h${i}`, n, `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`)).reverse();
    const f = fakeApi({ promos: [...names, 'W'], subs, watched: ['W'] });
    const reads: Record<string, Read> = { W: { courses: six(), weeks: W } };
    for (const n of names) reads[n] = { courses: six(), weeks: W };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await runOnce(deps(f.api, reads));
    expect(res.promos).toBe(21);
    expect(res.skipped).toStrictEqual(['S20', 'S21']);
    expect(log.mock.calls.map((x) => x.join(' '))).toStrictEqual(['sync: skipped 2 (over cap)']);
    log.mockRestore();
  });

  it('logs_counts_never_promo_names', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(MORNING);
    const promos = ['SECRET-A', 'SECRET-B', 'SECRET-C', ...Array.from({ length: 17 }, (_, i) => `P${i}`)];
    const f = fakeApi({ promos, subs: [sub('h1', 'SECRET-A', '2026-11-01T00:00:00.000Z'), sub('h2', 'SECRET-B', '2026-11-02T00:00:00.000Z'),
      sub('h3', 'SECRET-C', '2026-11-03T00:00:00.000Z'), sub('h4', 'SECRET-GONE')] });
    const d = deps(f.api, { 'SECRET-B': { courses: six(), weeks: W } }, MORNING, { list: async () => promos.slice(1) }); // drops a subscribed promo
    d.scrape.mockImplementationOnce(async () => { throw new Error('locator.click: Timeout, waiting for getByRole(\'option\', { name: \'SECRET-A\' }) /api/admin/state/SECRET-A%20x'); });
    d.scrape.mockImplementationOnce(async () => { vi.setSystemTime(MORNING.getTime() + 16 * 60_000); return { courses: six(), weeks: W }; });
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => { lines.push(a.join(' ')); });
    const err = vi.spyOn(console, 'error').mockImplementation((...a) => { lines.push(a.join(' ')); });
    const res = await runOnce({ ...d, deadline: new Date(MORNING.getTime() + 15 * 60_000) });
    expect(res.failed).toHaveLength(2); // promo-list + SECRET-A
    expect(res.skipped).toHaveLength(1); // SECRET-C, run time budget
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const l of lines) expect(l).not.toMatch(/SECRET/);
    log.mockRestore(); err.mockRestore();
  });

  it('get_watched_failure_falls_back_to_subscribers', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A')], watchedThrows: true });
    const res = await runOnce(deps(f.api, { A: { courses: six(), weeks: W } }));
    expect(res).toMatchObject({ promos: 1, failed: [] });
  });

  it('put_reads_failure_does_not_block_notifications', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A'), sub('h2', 'B')], putReadsThrows: true,
      state: { A: { snapshot: snap('A', six()), pending: null }, B: { snapshot: snap('B', six()), pending: null } } });
    const changed = six(); changed[0] = c('2026-11-24', '08:00', 'R9');
    const d = deps(f.api, { A: { courses: changed, weeks: W }, B: { courses: changed, weeks: W } });
    const res = await runOnce(d);
    expect(res.failed).toStrictEqual([]);
    expect(d.push).toHaveBeenCalledTimes(2);
  });

  it('hold_path_counts_as_read', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A')], state: { A: { snapshot: snap('A', six()), pending: null } } });
    const held = six().slice(0, 2); // big drop, not a total wipe: held as pending
    const res = await runOnce(deps(f.api, { A: { courses: held, weeks: W } }));
    expect(f.state.get('A')?.pending).not.toBeNull();
    expect(res.failed).toStrictEqual([]);
    expect(f.named('putReads')).toStrictEqual([['putReads', { A: IN.toISOString() }]]);
  });

  it('put_read_called_only_on_success', async () => {
    const f = fakeApi({ watched: ['A'] });
    await runOnce(deps(f.api, { A: new Error('grid unreadable') }));
    expect(f.named('putReads')).toStrictEqual([]);
  });

  it('total_wipe_does_not_put_read', async () => {
    const f = fakeApi({ watched: ['A'], state: { A: { snapshot: snap('A', six()), pending: null } } });
    const res = await runOnce(deps(f.api, { A: { courses: [], weeks: W } }));
    expect(res.failed).toStrictEqual(['A']);
    expect(f.named('putReads')).toStrictEqual([]);
  });

  it('failed_scrape_publishes_nothing_and_reports', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A'), sub('h2', 'B')], state: { B: { snapshot: snap('B', six()), pending: null } } });
    const d = deps(f.api, { A: new Error('grid unreadable'), B: { courses: six(), weeks: W } });
    const res = await runOnce(d);
    expect(res.failed).toStrictEqual(['A']);
    expect(f.named('putState')).toStrictEqual([]);
    expect(d.push).not.toHaveBeenCalled();
  });

  it('first_run_stores_snapshot_without_notifying', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A')] });
    const d = deps(f.api, { A: { courses: six(), weeks: W } });
    const res = await runOnce(d);
    expect(res).toStrictEqual({ promos: 1, changes: 0, failed: [], skipped: [] });
    expect(f.named('putState')).toStrictEqual([['putState', 'A', { snapshot: snap('A', six(), IN.toISOString()) }]]);
    expect(d.push).not.toHaveBeenCalled();
  });

  it('scrapes_current_monday_plus_three_and_stores_returned_weeks', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A')] });
    const d = deps(f.api, { A: { courses: six(), weeks: W.slice(0, 2) } });
    await runOnce(d);
    expect(d.scrape).toHaveBeenCalledWith('A', W);
    const body = f.named('putState')[0][2] as { snapshot: Snapshot };
    expect(body.snapshot.weeks).toStrictEqual(W.slice(0, 2));
  });

  it('change_notifies_only_that_promos_subscribers', async () => {
    const f = fakeApi({
      subs: [sub('h1', 'A'), sub('h2', 'A'), sub('h3', 'B')],
      state: { A: { snapshot: snap('A', six()), pending: null }, B: { snapshot: snap('B', six()), pending: null } },
    });
    const moved = six().map((x, i) => (i === 0 ? { ...x, room: 'R9' } : x));
    const d = deps(f.api, { A: { courses: moved, weeks: W }, B: { courses: six(), weeks: W } });
    const res = await runOnce(d);
    expect(res).toStrictEqual({ promos: 2, changes: 1, failed: [], skipped: [] });
    const puts = f.named('putState');
    expect(puts).toHaveLength(1);
    const [, promo, body] = puts[0] as [string, string, Record<string, unknown>];
    expect(promo).toBe('A');
    expect(Object.keys(body).sort()).toStrictEqual(['newChanges', 'snapshot']);
    expect(body.newChanges).toMatchObject([{ kind: 'local', promo: 'A' }]);
    expect(d.push).toHaveBeenCalledTimes(1);
    expect(d.push.mock.calls[0][0].map((s) => s.hash)).toStrictEqual(['h1', 'h2']);
    expect(d.push.mock.calls[0][1]).toMatchObject({ title: 'Changement de local', url: '/#/changements' });
    expect(d.push.mock.calls[0][2]).toBe(43200); // course ends tomorrow: capped at 12 h
  });

  it('no_change_writes_nothing', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A')], state: { A: { snapshot: snap('A', six(), '2026-11-20T10:00:00.000Z'), pending: null } } });
    const d = deps(f.api, { A: { courses: six().reverse(), weeks: W } });
    expect(await runOnce(d)).toStrictEqual({ promos: 1, changes: 0, failed: [], skipped: [] });
    expect(f.named('putState')).toStrictEqual([]);
    expect(f.named('putPromos')).toStrictEqual([]);
    expect(d.scrapeList).not.toHaveBeenCalled();
    expect(d.push).not.toHaveBeenCalled();
  });

  it('expired_subs_are_deleted', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A'), sub('h2', 'A')], state: { A: { snapshot: snap('A', six()), pending: null } } });
    const moved = six().map((x, i) => (i === 0 ? { ...x, room: 'R9' } : x));
    const d = deps(f.api, { A: { courses: moved, weeks: W } }, IN, { expired: ['h2'] });
    await runOnce(d);
    expect(f.named('deleteSub')).toStrictEqual([['deleteSub', 'h2']]);
  });

  it('week_rollover_stores_snapshot_without_changes_or_notification', async () => {
    const old = ['2026-11-16', ...W.slice(0, 3)];
    const prev = snap('A', [c('2026-11-17', '08:00'), ...six()], '2026-11-20T10:00:00.000Z', old);
    const f = fakeApi({ subs: [sub('h1', 'A')], state: { A: { snapshot: prev, pending: null } } });
    const d = deps(f.api, { A: { courses: six(), weeks: W } });
    expect(await runOnce(d)).toStrictEqual({ promos: 1, changes: 0, failed: [], skipped: [] });
    expect(f.named('putState')).toStrictEqual([['putState', 'A', { snapshot: snap('A', six(), IN.toISOString()) }]]);
    expect(d.push).not.toHaveBeenCalled();
  });

  it('read_back_to_normal_clears_stale_pending_only', async () => {
    const prev = snap('A', six());
    const pending = snap('A', six().slice(0, 1));
    const f = fakeApi({ subs: [sub('h1', 'A')], state: { A: { snapshot: prev, pending } } });
    const d = deps(f.api, { A: { courses: six(), weeks: W } });
    await runOnce(d);
    expect(f.named('putState')).toStrictEqual([['putState', 'A', { pending: null }]]);
    expect(d.push).not.toHaveBeenCalled();
  });

  it('suspicious_read_is_held_once_then_published_with_pending_cleared', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A')], state: { A: { snapshot: snap('A', six()), pending: null } } });
    const big = six().filter((x) => x.start === '08:00'); // big drop, one course left per week: not a week wipe
    const d = deps(f.api, { A: { courses: big, weeks: W } });
    expect((await runOnce(d)).failed).toStrictEqual([]);
    expect(f.named('putState')).toStrictEqual([['putState', 'A', { pending: snap('A', big, IN.toISOString()) }]]);
    expect(d.push).not.toHaveBeenCalled();

    const later = new Date(IN.getTime() + 30 * 60_000);
    const res = await runOnce({ ...d, now: later });
    expect(res.changes).toBe(4);
    const body = f.named('putState')[1][2] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toStrictEqual(['newChanges', 'pending', 'snapshot']);
    expect(body.pending).toBeNull();
  });

  it('total_wipe_fails_and_stores_pending_once', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A')], state: { A: { snapshot: snap('A', six()), pending: null } } });
    const d = deps(f.api, { A: { courses: [], weeks: W } });
    expect(await runOnce(d)).toStrictEqual({ promos: 1, changes: 0, failed: ['A'], skipped: [] });
    expect(f.named('putState')).toStrictEqual([['putState', 'A', { pending: snap('A', [], IN.toISOString()) }]]);
    expect(await runOnce({ ...d, now: new Date(IN.getTime() + 30 * 60_000) })).toStrictEqual({ promos: 1, changes: 0, failed: ['A'], skipped: [] });
    expect(f.named('putState')).toHaveLength(1);
    expect(d.push).not.toHaveBeenCalled();
  });

  it('empty_promo_list_is_refreshed_before_processing', async () => {
    const f = fakeApi({ promos: [], subs: [sub('h1', 'A')] });
    const d = deps(f.api, { A: { courses: six(), weeks: W } });
    expect((await runOnce(d)).failed).toStrictEqual([]);
    expect(f.named('putPromos')).toStrictEqual([['putPromos', ['A', 'B']]]);
    expect(f.named('putState')).toHaveLength(1);
  });

  it('first_run_of_day_refreshes_list_but_writes_only_if_changed', async () => {
    const same = fakeApi();
    const d1 = deps(same.api, {}, MORNING);
    await runOnce(d1);
    expect(d1.scrapeList).toHaveBeenCalledTimes(1);
    expect(same.named('putPromos')).toStrictEqual([]);

    const changed = fakeApi();
    const d2 = deps(changed.api, {}, MORNING, { list: async () => ['A', 'B', 'C'] });
    await runOnce(d2);
    expect(changed.named('putPromos')).toStrictEqual([['putPromos', ['A', 'B', 'C']]]);
  });

  it('late_cron_in_the_six_oclock_hour_still_refreshes_list', async () => {
    const f = fakeApi();
    const d = deps(f.api, {}, new Date('2026-11-23T05:45:00Z'), { list: async () => ['A', 'B', 'C'] }); // 06:45 Brussels
    await runOnce(d);
    expect(d.scrapeList).toHaveBeenCalledTimes(1);
    expect(f.named('putPromos')).toStrictEqual([['putPromos', ['A', 'B', 'C']]]);
    const seven = deps(fakeApi().api, {}, new Date('2026-11-23T06:00:00Z')); // 07:00 Brussels
    await runOnce(seven);
    expect(seven.scrapeList).not.toHaveBeenCalled();
  });

  it('no_subscribers_still_refreshes_list_and_marks_success', async () => {
    const f = fakeApi({ promos: [] });
    const d = deps(f.api, {});
    expect(await runOnce(d)).toStrictEqual({ promos: 0, changes: 0, failed: [], skipped: [] });
    expect(f.named('putPromos')).toHaveLength(1);
    expect(d.scrape).not.toHaveBeenCalled();
  });

  it('promo_list_failure_is_reported_and_other_promos_still_run', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A')] });
    const d = deps(f.api, { A: { courses: six(), weeks: W } }, MORNING, { list: async () => { throw new Error('timeout'); } });
    const res = await runOnce(d);
    expect(res.failed).toStrictEqual(['promo-list']);
    expect(f.named('putState')).toHaveLength(1);
  });

  it('subscribed_promo_missing_from_list_is_skipped_not_failed', async () => {
    const f = fakeApi({ promos: ['B'], subs: [sub('h1', 'Gone'), sub('h2', 'B')] });
    const d = deps(f.api, { Gone: { courses: six(), weeks: W }, B: { courses: six(), weeks: W } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await runOnce(d);
    expect(res).toStrictEqual({ promos: 1, changes: 0, failed: [], skipped: [] });
    expect(d.scrape).toHaveBeenCalledTimes(1);
    expect(d.scrape).toHaveBeenCalledWith('B', W);
    expect(f.calls.filter((x) => x[1] === 'Gone')).toStrictEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it('api_error_for_one_promo_does_not_stop_others', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A'), sub('h2', 'B')] });
    const getState = f.api.getState;
    f.api.getState = async (p) => { if (p === 'A') throw new Error('API GET state 500'); return getState(p); };
    const d = deps(f.api, { A: { courses: six(), weeks: W }, B: { courses: six(), weeks: W } });
    const res = await runOnce(d);
    expect(res.failed).toStrictEqual(['A']);
    expect(f.named('putState').map((x) => x[1])).toStrictEqual(['B']);
  });

  it('deadline_skips_remaining_promos_but_still_puts_reads', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(IN);
    const f = fakeApi({ promos: ['A', 'B', 'W'], subs: [sub('h1', 'A', '2026-11-05T00:00:00.000Z'), sub('h2', 'B', '2026-11-03T00:00:00.000Z'), sub('h3', 'B')], watched: ['W'] });
    const reads: Record<string, Read> = { A: { courses: six(), weeks: W }, B: { courses: six(), weeks: W }, W: { courses: six(), weeks: W } };
    const d = deps(f.api, reads);
    d.scrape.mockImplementationOnce(async () => { vi.setSystemTime(IN.getTime() + 16 * 60_000); return { courses: six(), weeks: W }; });
    const res = await runOnce({ ...d, deadline: new Date(IN.getTime() + 15 * 60_000) });
    expect(d.scrape.mock.calls.map((x) => x[0])).toStrictEqual(['B']); // oldest subscription first
    expect(res).toStrictEqual({ promos: 3, changes: 0, failed: [], skipped: ['A', 'W'] });
    expect(f.named('putReads')).toStrictEqual([['putReads', { B: IN.toISOString() }]]);
  });

  it('promos_ordered_by_oldest_subscription_then_watched', async () => {
    const at = (d: number) => `2026-11-${String(d).padStart(2, '0')}T00:00:00.000Z`;
    // Subscriber count does not matter: spam on a promo can never push an earlier subscriber back.
    const f = fakeApi({ promos: ['A', 'B', 'C', 'W'], subs: [sub('h1', 'A', at(3)), sub('h2', 'C', at(5)), sub('h3', 'C', at(1)), sub('h4', 'B', at(2)),
      sub('h5', 'C', at(9)), sub('h6', 'A', at(8)), sub('h7', 'A', at(7))], watched: ['W'] });
    const all: Record<string, Read> = {};
    for (const p of ['A', 'B', 'C', 'W']) all[p] = { courses: six(), weeks: W };
    const d = deps(f.api, all);
    await runOnce(d);
    expect(d.scrape.mock.calls.map((x) => x[0])).toStrictEqual(['C', 'B', 'A', 'W']);
  });

  it('get_subs_failure_throws_without_marking_success', async () => {
    const f = fakeApi({ subsThrows: true, watched: ['A'] });
    await expect(runOnce(deps(f.api, { A: { courses: six(), weeks: W } }))).rejects.toThrow('subs down');
    expect(f.named('putReads')).toStrictEqual([]);
  });

  it('all_weeks_disabled_keeps_previous_snapshot', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A')], state: { A: { snapshot: snap('A', six()), pending: null } } });
    const d = deps(f.api, { A: { courses: [], weeks: [] } });
    expect(await runOnce(d)).toStrictEqual({ promos: 1, changes: 0, failed: [], skipped: [] });
    expect(f.named('putState')).toStrictEqual([]);
    expect(f.named('putReads')).toStrictEqual([['putReads', { A: IN.toISOString() }]]);
    expect(d.push).not.toHaveBeenCalled();
  });

  it('week_wipe_still_publishes_other_weeks', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A')], state: { A: { snapshot: snap('A', six()), pending: null } } });
    // Week of 30/11 reads empty (held 3 courses: the grid broke); a real room change in the week of 23/11.
    const read = six().filter((x) => x.date === '2026-11-24').map((x, i) => (i === 0 ? { ...x, room: 'R9' } : x));
    const d = deps(f.api, { A: { courses: read, weeks: W } });
    const res = await runOnce(d);
    expect(res).toMatchObject({ changes: 1, failed: ['A'] }); // the maintainer hears about the wipe
    const [[, , body]] = f.named('putState') as [string, string, Record<string, any>][];
    expect(Object.keys(body).sort()).toStrictEqual(['newChanges', 'pending', 'snapshot']);
    expect(body.newChanges).toMatchObject([{ kind: 'local' }]);
    // Published: the new week, plus the previous courses of the wiped week. Pending keeps the raw read.
    expect(body.snapshot.courses).toStrictEqual([...read, ...six().filter((x) => x.date === '2026-12-01')]);
    expect(body.pending).toStrictEqual(snap('A', read, IN.toISOString()));
    expect(d.push).toHaveBeenCalledTimes(1);
    expect(d.push.mock.calls[0][1]).toMatchObject({ title: 'Changement de local' });
    expect(f.named('putReads')).toStrictEqual([]); // one week unverified: not fresh
  });

  it('week_wipe_alerts_once', async () => {
    const f = fakeApi({ subs: [sub('h1', 'A')], state: { A: { snapshot: snap('A', six()), pending: null } } });
    const firstWeekOnly = six().filter((x) => x.date === '2026-11-24');
    const d = deps(f.api, { A: { courses: firstWeekOnly, weeks: W } });
    expect((await runOnce(d)).failed).toStrictEqual(['A']);
    expect(f.named('putState')).toStrictEqual([['putState', 'A', { pending: snap('A', firstWeekOnly, IN.toISOString()) }]]);
    const later = (m: number) => new Date(IN.getTime() + m * 60_000);
    expect((await runOnce({ ...d, now: later(30) })).failed).toStrictEqual([]); // same wipe again: no new alert, no write
    expect((await runOnce({ ...d, now: later(60) })).failed).toStrictEqual([]);
    expect(f.named('putState')).toHaveLength(1);
    expect(f.state.get('A')?.snapshot).toStrictEqual(snap('A', six()));
    expect(d.push).not.toHaveBeenCalled();
    // A different wiped read is a new pending: one more alert.
    const other = six().filter((x) => x.date === '2026-11-24' && x.start !== '10:00');
    expect((await runOnce({ ...deps(f.api, { A: { courses: other, weeks: W } }), now: later(90) })).failed).toStrictEqual(['A']);
    // The week reads again: published as usual, pending cleared.
    expect((await runOnce({ ...deps(f.api, { A: { courses: six(), weeks: W } }), now: later(120) })).failed).toStrictEqual([]);
    expect(f.named('putState').at(-1)![2]).toMatchObject({ pending: null });
  });

  it('repeated_differing_holds_are_not_fresh_and_fail', async () => {
    const first = six().filter((x) => x.start === '08:00');
    const f = fakeApi({ subs: [sub('h1', 'A')], state: { A: { snapshot: snap('A', six()), pending: snap('A', first) } } });
    const other = six().filter((x) => x.start === '09:00');
    const res = await runOnce(deps(f.api, { A: { courses: other, weeks: W } }));
    expect(res.failed).toStrictEqual(['A']);
    expect(f.named('putState')).toStrictEqual([['putState', 'A', { pending: snap('A', other, IN.toISOString()) }]]);
    expect(f.named('putReads')).toStrictEqual([]);
  });

  it('refused_list_accepted_when_read_twice', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `P${i}`);
    const renamed = [...twenty.slice(1), 'P0 bis']; // the school renamed a subscribed promo
    const f = fakeApi({ promos: twenty, subs: [sub('h1', 'P0')] });
    const reads = { P0: { courses: six(), weeks: W } };
    const r1 = await runOnce(deps(f.api, reads, MORNING, { list: async () => renamed }));
    expect(r1.failed).toStrictEqual(['promo-list']);
    expect(f.named('putPromos')).toStrictEqual([]);
    expect(f.named('putPromosPending')).toStrictEqual([['putPromosPending', renamed]]);
    // 10:00, not the 06:xx hour: a pending list still triggers a refresh. Same list again: accepted.
    const d2 = deps(f.api, reads, IN, { list: async () => renamed });
    const r2 = await runOnce(d2);
    expect(d2.scrapeList).toHaveBeenCalledTimes(1);
    expect(r2.failed).toStrictEqual([]);
    expect(f.named('putPromos')).toStrictEqual([['putPromos', renamed]]);
    expect(f.named('putPromosPending').at(-1)).toStrictEqual(['putPromosPending', null]);
    // Nothing pending any more: no refresh outside 06:xx.
    const d3 = deps(f.api, reads, new Date(IN.getTime() + 30 * 60_000));
    await runOnce(d3);
    expect(d3.scrapeList).not.toHaveBeenCalled();
  });

  it('pending_list_read_differently_is_refused_again_or_dropped_when_moot', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `P${i}`);
    const f = fakeApi({ promos: twenty, subs: [sub('h1', 'P0')], promosPending: twenty.slice(1) });
    const reads = { P0: { courses: six(), weeks: W } };
    expect((await runOnce(deps(f.api, reads, IN, { list: async () => twenty.slice(2) }))).failed).toStrictEqual(['promo-list']);
    expect(f.named('putPromosPending')).toStrictEqual([['putPromosPending', twenty.slice(2)]]);
    // The page reads the stored list again: the pending one is dropped.
    expect((await runOnce(deps(f.api, reads, IN, { list: async () => twenty }))).failed).toStrictEqual([]);
    expect(f.named('putPromosPending').at(-1)).toStrictEqual(['putPromosPending', null]);
    expect(f.named('putPromos')).toStrictEqual([]);
  });

  it('shrunk_promo_list_is_refused', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `P${i}`);
    const lose = async () => twenty.slice(1); // drops P0 only: 5% of the list
    // Drops a subscribed promo.
    const f = fakeApi({ promos: twenty, subs: [sub('h1', 'P0')] });
    const d = deps(f.api, { P0: { courses: six(), weeks: W } }, MORNING, { list: lose });
    expect((await runOnce(d)).failed).toStrictEqual(['promo-list']);
    expect(f.named('putPromos')).toStrictEqual([]);
    expect(d.scrape).toHaveBeenCalledWith('P0', W);
    // Drops a watched promo.
    const w = fakeApi({ promos: twenty, watched: ['P0'] });
    expect((await runOnce(deps(w.api, { P0: { courses: six(), weeks: W } }, MORNING, { list: lose }))).failed).toStrictEqual(['promo-list']);
    expect(w.named('putPromos')).toStrictEqual([]);
    // Drops more than 10% of the list; exactly 10% (a rename or two) is accepted.
    const big = fakeApi({ promos: twenty });
    expect((await runOnce(deps(big.api, {}, MORNING, { list: async () => twenty.slice(3) }))).failed).toStrictEqual(['promo-list']);
    expect(big.named('putPromos')).toStrictEqual([]);
    const ok = fakeApi({ promos: twenty });
    expect((await runOnce(deps(ok.api, {}, MORNING, { list: async () => [...twenty.slice(2), 'New'] }))).failed).toStrictEqual([]);
    expect(ok.named('putPromos')).toStrictEqual([['putPromos', [...twenty.slice(2), 'New']]]);
  });

  it('browser_env_carries_no_secret', () => {
    const env = { PATH: '/usr/bin', HOME: '/home/runner', ADMIN_TOKEN: 't', VAPID_PRIVATE_KEY: 'k', API_BASE: 'b', VAPID_SUBJECT: 's', VAPID_PUBLIC_KEY: 'p' };
    expect(browserEnv(env)).toStrictEqual({ PATH: '/usr/bin', HOME: '/home/runner' });
  });
});
