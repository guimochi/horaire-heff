import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { setVapidDetails } from 'web-push';
import { addDays, brusselsParts, isInRunWindow, mondayOf } from '../shared/time';
import type { Course, Snapshot } from '../shared/types';
import { createApiClient, type ApiClient } from './api-client';
import { diffSnapshots } from './diff';
import { canon, decidePublish, isTotalWipe, wipedWeeks } from './guard';
import { notificationFor, pushTtl } from './notify-text';
import { sendAll } from './push';
import { scrapePromo, scrapePromoList } from './scrape';

// shortcut: caps bound the scrapes per run (and our load on the school's site) whatever is stored; promos past them
// wait for a slot. Oldest first, so later spam crowds out only itself. Upgrade to per-device tokens if real users hit them.
const MAX_SUBSCRIBED = 20;
const MAX_WATCHED_ONLY = 12;
const RUN_BUDGET_MS = 15 * 60_000;
const MAX_LIST_DROP = 0.1;

// `silent`: publish what is read without recording changes nor pushing (once, after a reader fix moves stored values).
export async function runOnce(deps: { now: Date; deadline?: Date; api: ApiClient; silent?: boolean;
  scrape: (promo: string, weeks: string[]) => Promise<{ courses: Course[]; weeks: string[] }>;
  scrapeList: () => Promise<string[]>; push: typeof sendAll }): Promise<{ promos: number; changes: number; failed: string[]; skipped: string[] }> {
  const { now, api } = deps;
  const out = { promos: 0, changes: 0, failed: [] as string[], skipped: [] as string[] };
  if (!isInRunWindow(now)) return out;
  const nowIso = now.toISOString();
  const { date, hour } = brusselsParts(now);
  const reads: Record<string, string> = {};

  try {
    let promos = await api.getPromos();
    const subs = await api.getSubs();
    let watched: Awaited<ReturnType<ApiClient['getWatched']>> = [];
    try { watched = await api.getWatched(); } catch (e) { console.error(`sync: watched: ${(e as Error).message}`); }

    let listPending: string[] | null = null;
    try { listPending = await api.getPromosPending(); } catch (e) { console.error(`sync: promo-list pending: ${(e as Error).message}`); }

    // Refresh before the loop: state routes 404 for a promo missing from the list.
    // Whole 06:xx hour so a late cron still refreshes, and every run while a refused list waits for its second read.
    if (promos.length === 0 || hour === 6 || listPending) {
      try {
        const fresh = await deps.scrapeList();
        const same = (a: string[] | null) => JSON.stringify(a) === JSON.stringify(fresh);
        if (!same(promos)) {
          // A half-loaded list must never drop a promo someone uses, nor a big chunk of the others.
          const used = new Set([...subs.map((s) => s.promo), ...watched.map((w) => w.promo)]);
          const dropped = promos.filter((p) => !fresh.includes(p));
          const refused = dropped.some((p) => used.has(p)) || dropped.length > promos.length * MAX_LIST_DROP;
          // ...but the same list read on two runs in a row is the school's real list (e.g. promos renamed at year change).
          if (refused && !same(listPending)) {
            out.failed.push('promo-list');
            console.error(`sync: promo-list: refused, would drop ${dropped.length} of ${promos.length}`); // counts only: the logs are public
            await api.putPromosPending(fresh);
          } else {
            await api.putPromos(fresh);
            promos = fresh;
            if (listPending) await api.putPromosPending(null);
          }
        } else if (listPending) await api.putPromosPending(null); // the page reads the stored list again
      } catch (e) {
        out.failed.push('promo-list');
        console.error(`sync: promo-list: ${(e as Error).message}`);
      }
    }

    // Each subscribed promo ranks by its oldest subscription, each watched-only promo by its first view.
    const oldest = new Map<string, string>();
    for (const s of subs) if (!(oldest.get(s.promo)! <= s.at)) oldest.set(s.promo, s.at);
    // A promo renamed or dropped by the school (e.g. at year change) is skipped, not failed: no daily failure e-mails.
    const unlisted = [...oldest.keys()].filter((p) => !promos.includes(p)).length;
    if (unlisted) console.log(`sync: skipped ${unlisted} (not in promo list)`);
    const subbed = [...oldest.keys()].filter((p) => promos.includes(p)).sort((a, b) => oldest.get(a)!.localeCompare(oldest.get(b)!));
    const watchedOnly = watched.filter((w) => !oldest.has(w.promo) && promos.includes(w.promo))
      .sort((a, b) => a.first.localeCompare(b.first)).map((w) => w.promo);
    // Subscribed, then watched-only: a run cut by the time budget drops the newest first.
    const active = [...subbed.slice(0, MAX_SUBSCRIBED), ...watchedOnly.slice(0, MAX_WATCHED_ONLY)];
    out.skipped.push(...subbed.slice(MAX_SUBSCRIBED), ...watchedOnly.slice(MAX_WATCHED_ONLY));
    if (out.skipped.length) console.log(`sync: skipped ${out.skipped.length} (over cap)`);
    out.promos = active.length;
    const monday = mondayOf(date);
    const weeks = [0, 7, 14, 21].map((n) => addDays(monday, n));

    let late = 0;
    for (const promo of active) {
      if (deps.deadline && Date.now() > deps.deadline.getTime()) {
        out.skipped.push(promo);
        late++;
        continue;
      }
      try {
        const read = await deps.scrape(promo, weeks);
        const next: Snapshot = { promo, fetchedAt: nowIso, weeks: read.weeks, courses: read.courses };
        const { snapshot: prev, pending } = await api.getState(promo);
        // Every week disabled or absent (holidays, year end): nothing to compare, keep what users see.
        if (read.weeks.length === 0 && prev) { reads[promo] = nowIso; continue; }
        const newPending = !pending || canon(pending) !== canon(next);

        // A week that held courses reads empty: the grid broke there. Keep that week as users see it, publish the others.
        const total = isTotalWipe(prev, next);
        const wiped = total ? [] : wipedWeeks(prev, next);
        const publish: Snapshot = wiped.length
          ? { ...next, courses: [...next.courses.filter((c) => !wiped.includes(mondayOf(c.date))),
            ...prev!.courses.filter((c) => wiped.includes(mondayOf(c.date)))] }
          : next;
        // Page broke everywhere, or a wipe plus another suspicious drop: alert the maintainer via the exit code, keep what users see.
        if (total || (wiped.length && !decidePublish(prev, pending, publish).publish)) {
          out.failed.push(promo);
          if (newPending) await api.putState(promo, { pending: next });
          continue;
        }
        if (wiped.length) {
          if (newPending) out.failed.push(promo); // one alert per distinct broken read (kept as pending), not one per run
        } else if (!decidePublish(prev, pending, next).publish) {
          if (newPending) await api.putState(promo, { pending: next });
          // A second suspicious read that differs from the first is not a stable read: not fresh, and reported.
          if (pending) { out.failed.push(promo); continue; }
          reads[promo] = nowIso; // first hold: the read itself succeeded
          continue;
        }

        const changes = prev && !deps.silent ? diffSnapshots(prev, publish, nowIso) : [];
        const body: Parameters<ApiClient['putState']>[1] = {};
        if (!prev || canon(prev) !== canon(publish)) body.snapshot = publish;
        if (changes.length) body.newChanges = changes;
        if (wiped.length) { if (newPending) body.pending = next; } else if (pending) body.pending = null;
        if (Object.keys(body).length) await api.putState(promo, body); // KV free tier: no write when nothing changed
        out.changes += changes.length;
        if (!wiped.length) reads[promo] = nowIso; // a wiped week is unverified: not fresh

        const note = notificationFor(changes, now);
        if (!note) continue;
        const { expired } = await deps.push(subs.filter((s) => s.promo === promo), note, pushTtl(changes, now), undefined, deps.deadline);
        for (const hash of expired) {
          try { await api.deleteSub(hash); } catch (e) { console.error(`sync: deleteSub: ${(e as Error).message}`); }
        }
      } catch (e) {
        out.failed.push(promo);
        // The logs are public: the name is cut from the message too (Playwright locators and API paths carry it).
        const msg = String((e as Error)?.message).split(promo).join('<promo>').split(encodeURIComponent(promo)).join('<promo>');
        console.error(`sync: promo failed: ${msg}`);
      }
    }
    if (late) console.log(`sync: skipped ${late} (run time budget)`);
  } finally {
    // Bookkeeping is log-only: it must never fail promos already saved or block pushes.
    // shortcut: one batched KV key (meta:reads) = 1 write/run; grows with promo count, fine for a few dozen promos.
    if (Object.keys(reads).length) {
      try { await api.putReads(reads); } catch (e) { console.error(`sync: putReads: ${(e as Error).message}`); }
    }
  }
  return out;
}

// Chromium renders the school's third-party pages: it gets no secret in its environment.
export const browserEnv = (env: NodeJS.ProcessEnv) => ({ PATH: env.PATH ?? '', HOME: env.HOME ?? '' });

async function cli(): Promise<number> {
  const env = process.env;
  const required = ['API_BASE', 'ADMIN_TOKEN', 'VAPID_SUBJECT', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) { console.error(`sync: missing env ${missing.join(', ')}`); return 2; }
  setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);

  // Browser launched lazily: runs outside the window or without subscribers never start it.
  let browser: Browser | undefined;
  let page: Page | undefined;
  const getPage = async () => page ??= await (browser ??= await chromium.launch({ headless: true, env: browserEnv(env) })).newPage();
  try {
    const res = await runOnce({
      now: new Date(), deadline: new Date(Date.now() + RUN_BUDGET_MS), api: createApiClient(env.API_BASE!, env.ADMIN_TOKEN!), push: sendAll,
      silent: env.SYNC_SILENT === 'true',
      scrape: async (promo, weeks) => scrapePromo(await getPage(), promo, weeks),
      scrapeList: async () => scrapePromoList(await getPage()),
    });
    // Counts only: the Actions logs of a public repo must not tell which promo is in use.
    console.log(`sync: promos=${res.promos} changes=${res.changes} failed=${res.failed.length} skipped=${res.skipped.length}`);
    return res.failed.length ? 1 : 0;
  } finally {
    await browser?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().then((code) => process.exit(code), (e) => { console.error(`sync: ${(e as Error).message}`); process.exit(1); });
}
