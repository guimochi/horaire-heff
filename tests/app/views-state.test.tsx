// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { Change, Course, Snapshot } from '../../src/shared/types';
import type { Schedule } from '../../src/app/data';
import { hasWeekAhead } from '../../src/app/model';
import { Day } from '../../src/app/views/Day';
import { Week } from '../../src/app/views/Week';
import { Changes } from '../../src/app/views/Changes';
import { App } from '../../src/app/App';

const NOW = new Date('2026-11-23T08:40:00Z'); // lun. 09:40 Brussels
const P = 'BA3 - S3 - EPS';
const course: Course = { date: '2026-11-24', start: '09:00', end: '12:00', subject: 'Sports et jeux', teacher: '', room: 'Bolingo', group: '3 EDP', cancelled: false, extra: [] };
const snap = (weeks: string[], courses: Course[] = []): Snapshot => ({ promo: P, fetchedAt: '2026-11-23T08:30:00.000Z', weeks, courses });
const ready = (s: Snapshot, lastSuccess: string | null = '2026-11-23T08:30:00.000Z'): Schedule => ({ state: 'ready', snapshot: s, lastSuccess });
const ch = (id: string, detectedAt: string): Change => ({ id, kind: 'local', promo: P, detectedAt, before: { ...course, room: 'X' }, after: course });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); location.hash = ''; });

describe('no published week ahead', () => {
  it('has_week_ahead_only_for_current_or_later_weeks', () => {
    expect(hasWeekAhead(snap(['2026-11-23']), NOW)).toBe(true);
    expect(hasWeekAhead(snap(['2026-11-30']), NOW)).toBe(true);
    expect(hasWeekAhead(snap(['2026-11-16']), NOW)).toBe(false);
    expect(hasWeekAhead(snap([]), NOW)).toBe(false);
    expect(hasWeekAhead(snap(['2026-11-23']), new Date('2026-11-29T12:00:00Z'))).toBe(true); // Sunday belongs to its week
  });
  it('day_and_week_show_calm_state_not_error', () => {
    for (const View of [Day, Week]) {
      render(<View promo={P} schedule={ready(snap([]))} changes={[]} now={NOW} retry={() => {}} />);
      expect(screen.getByText("Aucune semaine publiée pour l'instant")).toBeTruthy();
      expect(screen.queryByText(/Impossible de charger/)).toBeNull();
      expect(screen.queryByText('Pas de cours')).toBeNull();
      expect(screen.getByText(/Mis à jour/)).toBeTruthy();
      cleanup();
    }
    render(<Week promo={P} schedule={ready(snap(['2026-11-16'], [{ ...course, date: '2026-11-17' }]))} changes={[]} now={NOW} retry={() => {}} />);
    expect(screen.getByText("Aucune semaine publiée pour l'instant")).toBeTruthy();
  });
});

describe('Changes freshness', () => {
  const props = { promo: P, now: NOW, seenBefore: null, clearedAt: null, setClearedAt: () => {} };
  it('stale_feed_says_no_change_received_under_the_banner', () => {
    render(<Changes {...props} changes={[]} schedule={ready(snap(['2026-11-23']), '2026-11-22T17:00:00.000Z')} />);
    expect(screen.getByText(/Horaire peut-être pas à jour/)).toBeTruthy();
    expect(screen.getByText('Aucun changement reçu')).toBeTruthy();
    expect(screen.queryByText('Tout est à jour')).toBeNull();
    expect(screen.getByText(/Mis à jour/)).toBeTruthy();
  });
  it('fresh_feed_says_all_clear_with_footer', () => {
    render(<Changes {...props} changes={[]} schedule={ready(snap(['2026-11-23']))} />);
    expect(screen.queryByText(/Horaire peut-être pas à jour/)).toBeNull();
    expect(screen.getByText('Tout est à jour')).toBeTruthy();
    expect(screen.getByText(/Mis à jour il y a 10 min/)).toBeTruthy();
  });
});

describe('Shell data', () => {
  function serve(feed: () => Change[]) {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      const body = url.startsWith('/api/schedule/') ? { snapshot: snap(['2026-11-23'], [course]), lastSuccess: new Date().toISOString() } : feed();
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    return calls;
  }
  const start = (hash: string) => { localStorage.setItem('horaire.promo', P); location.hash = hash; render(<App />); };
  const badge = () => screen.getByRole('link', { name: /Changements/ }).textContent;

  it('first_load_marks_backlog_seen_badge_starts_at_zero', async () => {
    serve(() => [ch('b', '2026-11-23T08:00:00.000Z'), ch('a', '2026-11-22T08:00:00.000Z')]);
    start('#/jour');
    await waitFor(() => expect(localStorage.getItem('horaire.lastSeenAt')).toBe('2026-11-23T08:00:00.000Z'));
    expect(badge()).toBe('Changements');
  });

  it('empty_first_feed_still_counts_the_next_change', async () => {
    let feed: Change[] = [];
    serve(() => feed);
    start('#/jour');
    await waitFor(() => expect(localStorage.getItem('horaire.lastSeenAt')).toBe(new Date(0).toISOString()));
    feed = [ch('n', '2026-11-23T09:00:00.000Z')];
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(badge()).toContain('1 non lu'));
  });

  it('opening_changements_refetches_the_feed', async () => {
    const calls = serve(() => []);
    start('#/jour');
    await waitFor(() => expect(calls.filter((u) => u.startsWith('/api/changes/'))).toHaveLength(1));
    location.hash = '#/changements';
    fireEvent(window, new HashChangeEvent('hashchange'));
    await waitFor(() => expect(calls.filter((u) => u.startsWith('/api/changes/'))).toHaveLength(2));
    expect(calls.filter((u) => u.startsWith('/api/schedule/'))).toHaveLength(1);
  });
});
