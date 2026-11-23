import { describe, expect, it } from 'vitest';
import { isInRunWindow, isStale, mondayOf, nextSlotAfter } from '../../src/shared/time';

describe('time', () => {
  it('isInRunWindow', () => {
    expect(isInRunWindow(new Date('2026-11-23T09:40:00+01:00'))).toBe(true);
    expect(isInRunWindow(new Date('2026-11-29T12:00:00+01:00'))).toBe(false);
    expect(isInRunWindow(new Date('2026-11-23T05:59:00+01:00'))).toBe(false);
  });
  it('nextSlotAfter', () => {
    expect(nextSlotAfter(new Date('2026-11-28T21:40:00+01:00')).toISOString()).toBe('2026-11-28T21:00:00.000Z');
    expect(nextSlotAfter(new Date('2026-11-28T22:00:00+01:00')).toISOString()).toBe('2026-11-30T05:00:00.000Z');
  });
  it('nextSlotAfter across DST (CEST, UTC+2)', () => {
    expect(nextSlotAfter(new Date('2026-07-15T10:10:00+02:00')).toISOString()).toBe('2026-07-15T08:30:00.000Z');
    // Sat 28 Mar 2026 22:00 CET -> Mon 30 Mar 06:00 CEST (spring-forward on Sun 29)
    expect(nextSlotAfter(new Date('2026-03-28T22:00:00+01:00')).toISOString()).toBe('2026-03-30T04:00:00.000Z');
  });
  it('isStale', () => {
    expect(isStale(new Date('2026-11-28T22:00:00+01:00'), new Date('2026-11-29T12:00:00+01:00'))).toBe(false);
    expect(isStale(new Date('2026-11-30T08:30:00+01:00'), new Date('2026-11-30T10:01:00+01:00'))).toBe(true);
    expect(isStale(new Date('2026-11-30T08:30:00+01:00'), new Date('2026-11-30T10:00:00+01:00'))).toBe(false);
    expect(isStale(new Date('2026-11-28T22:00:00+01:00'), new Date('2026-11-30T06:10:00+01:00'))).toBe(false);
  });
  it('mondayOf', () => {
    expect(mondayOf('2026-11-26')).toBe('2026-11-23');
    expect(mondayOf('2026-11-29')).toBe('2026-11-23');
    expect(mondayOf('2026-11-23')).toBe('2026-11-23');
  });
});
