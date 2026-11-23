import { describe, it, expect } from 'vitest';
import { isSuspicious, isTotalWipe, isWeekWipe, decidePublish } from '../../src/sync/guard';
import type { Course, Snapshot } from '../../src/shared/types';

const base: Course = { date: '2026-11-24', start: '08:00', end: '10:00', subject: 'S',
  teacher: 'T', room: 'R', group: '', cancelled: false, extra: [] };
const n = (k: number, date = '2026-11-24'): Course[] =>
  Array.from({ length: k }, (_, i) => ({ ...base, date, start: `${String(8 + i).padStart(2, '0')}:00` }));
const snap = (courses: Course[], weeks = ['2026-11-23'], fetchedAt = 'x'): Snapshot =>
  ({ promo: 'P', fetchedAt, weeks, courses });

describe('guard', () => {
  it('first_snapshot_publishes', () =>
    expect(decidePublish(null, null, snap(n(0)))).toEqual({ publish: true, pending: null }));
  it('normal_change_publishes_immediately', () =>
    expect(decidePublish(snap(n(6)), null, snap(n(5)))).toEqual({ publish: true, pending: null }));
  it('week_emptied_is_held', () => {
    const prev = snap([...n(3, '2026-11-24'), ...n(3, '2026-12-01')], ['2026-11-23', '2026-11-30']);
    const next = snap(n(3, '2026-11-24'), ['2026-11-23', '2026-11-30']);
    expect(isSuspicious(prev, next)).toBe(true);
    expect(decidePublish(prev, null, next)).toEqual({ publish: false, pending: next });
  });
  it('same_suspicious_read_twice_publishes', () => {
    const prev = snap([...n(3, '2026-11-24'), ...n(2, '2026-12-01')], ['2026-11-23', '2026-11-30']);
    const next = snap(n(3, '2026-11-24'), ['2026-11-23', '2026-11-30'], 'a');
    const pending = snap([...n(3, '2026-11-24')].reverse(), ['2026-11-23', '2026-11-30'], 'b');
    expect(decidePublish(prev, pending, next)).toEqual({ publish: true, pending: null });
  });
  it('different_suspicious_read_replaces_pending', () => {
    const prev = snap(n(6));
    const next = snap(n(2));
    const pending = snap(n(1));
    expect(decidePublish(prev, pending, next)).toEqual({ publish: false, pending: next });
  });
  it('drop_below_half_is_held', () => {
    const next = snap(n(2));
    expect(decidePublish(snap(n(6)), null, next)).toEqual({ publish: false, pending: next });
  });
  it('small_prev_not_suspicious', () =>
    expect(decidePublish(snap(n(3)), null, snap(n(1)))).toEqual({ publish: true, pending: null }));
  it('total_wipe_is_never_confirmed', () => {
    const next = snap(n(0));
    expect(decidePublish(snap(n(6)), next, next)).toEqual({ publish: false, pending: next });
  });
  it('week_wipe_is_never_confirmed', () => {
    const W2 = ['2026-11-23', '2026-11-30'];
    const prev = snap([...n(3, '2026-11-24'), ...n(3, '2026-12-01')], W2);
    const next = snap(n(3, '2026-11-24'), W2);
    expect(isWeekWipe(prev, next)).toBe(true);
    expect(isTotalWipe(prev, next)).toBe(false);
    expect(decidePublish(prev, next, next)).toEqual({ publish: false, pending: next });
    expect(isWeekWipe(null, next)).toBe(false);
    expect(isWeekWipe(prev, snap(n(3, '2026-11-24'), ['2026-11-23']))).toBe(false); // week no longer read: not common
  });
  it('small_week_to_zero_still_confirms', () => {
    const W2 = ['2026-11-23', '2026-11-30'];
    const prev = snap([...n(3, '2026-11-24'), ...n(2, '2026-12-01')], W2);
    const next = snap(n(3, '2026-11-24'), W2);
    expect(isWeekWipe(prev, next)).toBe(false);
    expect(decidePublish(prev, null, next)).toEqual({ publish: false, pending: next });
    expect(decidePublish(prev, next, next)).toEqual({ publish: true, pending: null });
  });
  it('isTotalWipe_detects_and_ignores_small_prev', () => {
    expect(isTotalWipe(snap(n(6)), snap(n(0)))).toBe(true);
    expect(isTotalWipe(snap(n(3)), snap(n(0)))).toBe(false);
    expect(isTotalWipe(null, snap(n(0)))).toBe(false);
  });
  it('total_wipe_ignores_non_common_weeks', () => {
    const prev = snap(n(6), ['2026-11-23', '2026-11-30']);
    const next = snap(n(0), ['2026-11-30']);
    expect(isTotalWipe(prev, next)).toBe(false);
  });
});
