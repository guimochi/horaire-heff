// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { Course, Snapshot } from '../../src/shared/types';
import type { Schedule } from '../../src/app/data';
import { Day } from '../../src/app/views/Day';
import { Week } from '../../src/app/views/Week';

const NOW = new Date('2026-11-23T08:40:00Z'); // lun. 09:40 Brussels
const P = 'BA3 - S3 - EPS';
const c = (date: string, subject: string): Course => ({ date, start: '09:00', end: '12:00', subject, teacher: '', room: 'A1', group: '', cancelled: false, extra: [] });
const WEEKS = ['2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14'];
const snap: Snapshot = { promo: P, fetchedAt: '2026-11-23T08:30:00.000Z', weeks: WEEKS,
  courses: [c('2026-11-24', 'Maths'), c('2026-12-08', 'Histoire'), c('2026-12-10', 'Musique')] };
const ready: Schedule = { state: 'ready', snapshot: snap, lastSuccess: '2026-11-23T08:30:00.000Z' };
const props = { promo: P, schedule: ready, changes: [], now: NOW, retry: () => {} };
const pick = (v: string) => fireEvent.input(screen.getByLabelText('Aller à une date'), { target: { value: v } });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('go to a date', () => {
  it('day_view_jumps_to_the_picked_day', () => {
    render(<Day {...props} />);
    pick('2026-12-08');
    expect(screen.getByText('Mardi 8 décembre')).toBeTruthy();
    expect(screen.getByText('Histoire')).toBeTruthy();
  });

  it('picker_is_bounded_by_published_weeks', () => {
    render(<Day {...props} />);
    const input = screen.getByLabelText('Aller à une date') as HTMLInputElement;
    expect(input.min).toBe('2026-11-23');
    expect(input.max).toBe('2026-12-20');
  });

  it('unpublished_or_cleared_date_changes_nothing', () => {
    render(<Day {...props} />);
    pick('2027-01-12');
    expect((screen.getByLabelText('Aller à une date') as HTMLInputElement).value).toBe('2026-11-23'); // field resynced
    pick('');
    expect((screen.getByLabelText('Aller à une date') as HTMLInputElement).value).toBe('2026-11-23');
    expect(screen.getByText('Lundi 23 novembre')).toBeTruthy();
  });

  it('week_view_switches_week_and_scrolls_the_picked_day_to_top', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<Week {...props} />);
    pick('2026-12-08');
    expect(screen.getByText('7 – 12 décembre')).toBeTruthy();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect((scroll.mock.contexts[0] as HTMLElement).dataset.date).toBe('2026-12-08');
    expect((screen.getByLabelText('Aller à une date') as HTMLInputElement).value).toBe('2026-12-08'); // reopens on the picked day
  });

  it('week_view_no_later_day_with_courses_fills_the_page_with_the_last_day', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<Week {...props} />);
    pick('2026-12-11');
    expect((scroll.mock.contexts[0] as HTMLElement).dataset.date).toBe('2026-12-10');
  });

  it('week_view_empty_day_scrolls_to_the_next_day_with_courses', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<Week {...props} />);
    pick('2026-12-09');
    expect((scroll.mock.contexts[0] as HTMLElement).dataset.date).toBe('2026-12-10');
    pick('2026-12-09'); // same date again still scrolls
    expect(scroll).toHaveBeenCalledTimes(2);
  });
});
