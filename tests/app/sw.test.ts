import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const SRC = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://app.test';

// Runs public/sw.js against a fake worker scope and returns its listeners.
function load(files: Record<string, string> = {}) {
  const on: Record<string, (e: any) => void> = {};
  const stored: string[] = [];
  const cache = {
    put: async (k: string) => { stored.push(k); },
    addAll: async (urls: string[]) => { stored.push(...urls); },
    match: async (k: string) => (k in files ? new Response(files[k]) : undefined),
  };
  const clients = { matchAll: vi.fn(async () => []), openWindow: vi.fn(async (_url: string) => {}), claim: async () => {} };
  const self = { location: { href: `${ORIGIN}/sw.js?v=1`, origin: ORIGIN }, addEventListener: (t: string, f: any) => { on[t] = f; },
    clients, skipWaiting: async () => {}, registration: {} };
  const fetch = async (u: string) => new Response(files[u] ?? '', { status: u in files ? 200 : 404 });
  new Function('self', 'caches', 'fetch', SRC)(self, { open: async () => cache, keys: async () => [] }, fetch);
  return { on, clients, stored };
}

const click = (on: Record<string, (e: any) => void>, url: unknown) => {
  let done: Promise<unknown> = Promise.resolve();
  on.notificationclick({ notification: { close: () => {}, data: { url } }, waitUntil: (p: Promise<unknown>) => { done = p; } });
  return done;
};

describe('service worker', () => {
  it('notificationclick_opens_only_own_origin_urls', async () => {
    const { on, clients } = load();
    await click(on, 'https://evil.example/phish');
    await click(on, '//evil.example/x');
    await click(on, '/#/jour');
    await click(on, undefined);
    expect(clients.openWindow.mock.calls.map((c) => c[0])).toEqual([
      `${ORIGIN}/#/changements`, `${ORIGIN}/#/changements`, `${ORIGIN}/#/jour`, `${ORIGIN}/#/changements`]);
  });

  it('install_precaches_fonts_referenced_from_css', async () => {
    const html = '<link rel="stylesheet" href="/assets/index-a.css"><script type="module" src="/assets/index-b.js"></script>';
    const css = '@font-face{src:url(/assets/inter-latin-400-normal-x.woff2) format("woff2"),url(/assets/inter-latin-400-normal-x.woff) format("woff")}' +
      '@font-face{src:url("/assets/bricolage-grotesque-latin-700-normal-y.woff2") format("woff2")}';
    const { on, stored } = load({ '/': html, '/assets/index-a.css': css });
    let done: Promise<unknown> = Promise.resolve();
    on.install({ waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    expect(stored).toEqual(expect.arrayContaining(['/assets/index-a.css', '/assets/index-b.js',
      '/assets/inter-latin-400-normal-x.woff2', '/assets/bricolage-grotesque-latin-700-normal-y.woff2']));
    expect(stored.some((u) => u.endsWith('.woff'))).toBe(false); // woff2 only: every target browser reads it
  });
});
