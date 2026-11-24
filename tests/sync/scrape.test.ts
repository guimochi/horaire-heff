import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkGridCounts, dayLabels, readWeeks, settle, weekIndexes, type RawWeek } from '../../src/sync/scrape';

const fx = (f: string): RawWeek => ({ ...JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8')), disabled: false });

describe('readWeeks', () => {
  it('omits disabled weeks instead of reporting them empty', () => {
    const disabled: RawWeek = { weekLabel: 'Semaine fériée, du 21/12/2026 au 26/12/2026', weekStart: '2026-12-21', disabled: true, groups: [], courses: [] };
    const r = readWeeks([fx('courses-2026-12-14.json'), disabled]);
    expect(r.weeks).toEqual(['2026-12-14']);
    expect(r.courses).toHaveLength(9);
  });
  it('keeps an enabled empty week', () => {
    const empty: RawWeek = { weekLabel: 'Semaine 12, du 23/11/2026 au 28/11/2026', weekStart: '2026-11-23', disabled: false, groups: [], courses: [] };
    expect(readWeeks([empty])).toEqual({ courses: [], weeks: ['2026-11-23'] });
  });
  it('passes the week\'s teacher names to the parser', () => {
    const course = { aria: 'Cours du 24 novembre de 9 heures 00 à 12 heures 00', lines: ['AFP 1', 'Leroy Anne', 'Renard Hélène', '1.1.06'], cancelledMarker: false };
    const w: RawWeek = { weekLabel: '', weekStart: '2026-11-23', disabled: false, groups: [], courses: [course], teachers: ['Leroy Anne', 'Renard Hélène'] };
    expect(readWeeks([w]).courses[0]).toMatchObject({ teacher: 'Leroy Anne, Renard Hélène', room: '1.1.06' });
  });
  it('throws on a course outside its week (stale grid)', () => {
    const w = fx('courses-2026-11-23.json');
    expect(() => readWeeks([{ ...w, weekStart: '2026-11-30' }])).toThrow(/hors semaine/);
  });
});

describe('checkGridCounts', () => {
  it('accepts consistent counts, including a real empty week', () => {
    expect(() => checkGridCounts({ courses: 14, cells: 14, contents: 14, labelled: 14 }, '2026-11-23')).not.toThrow();
    expect(() => checkGridCounts({ courses: 0, cells: 0, contents: 0, labelled: 0 }, '2026-11-23')).not.toThrow();
  });
  it('throws when course-like elements exist but the strict selector reads none', () => {
    expect(() => checkGridCounts({ courses: 0, cells: 14, contents: 14, labelled: 0 }, '2026-11-23')).toThrow(/illisible/);
  });
  it('throws when any count disagrees', () => {
    expect(() => checkGridCounts({ courses: 14, cells: 14, contents: 0, labelled: 14 }, '2026-11-23')).toThrow(/illisible/);
    expect(() => checkGridCounts({ courses: 14, cells: 15, contents: 14, labelled: 14 }, '2026-11-23')).toThrow(/illisible/);
  });
});

describe('weekIndexes', () => {
  const options = [{ label: 'Semaine 12, du 23/11/2026 au 28/11/2026', disabled: false }, { label: 'Semaine 13, du 30/11/2026 au 05/12/2026', disabled: true }];
  it('absent_week_is_minus_one_not_an_error', () => {
    expect(weekIndexes(options, ['2026-11-23', '2026-11-30', '2026-12-07'])).toEqual([0, 1, -1]);
    expect(weekIndexes(options, ['2027-06-28'])).toEqual([-1]);
  });
  it('empty_week_list_throws', () => {
    expect(() => weekIndexes([], ['2026-11-23'])).toThrow(/semaines/);
  });
  it('week_label_drift_throws', () => {
    // A label format change must not read as « every week absent » (an empty, calm timetable).
    expect(() => weekIndexes([{ label: 'Semaine 12 (23/11 - 28/11)', disabled: false }], ['2026-11-23'])).toThrow(/semaines/);
  });
});

describe('settle', () => {
  const seq = <T>(...v: T[]) => { let i = 0; return async () => v[Math.min(i++, v.length - 1)]; };
  const empty = (n: number) => n === 0;
  it('empty_grid_is_read_again_before_being_accepted', async () => {
    const waits: number[] = [];
    const wait = async (ms: number) => { waits.push(ms); };
    expect(await settle(seq(0, 0, 5, 5), wait, empty, 'x')).toBe(5);
    expect(waits).toContain(3000);
    expect(await settle(seq(0, 0, 0), async () => {}, empty, 'x')).toBe(0);
  });
  it('stops_on_two_identical_non_empty_reads', async () => {
    const waits: number[] = [];
    expect(await settle(seq(3, 4, 4), async (ms) => { waits.push(ms); }, empty, 'x')).toBe(4);
    expect(waits).toEqual([300, 300]);
  });
});

describe('dayLabels', () => {
  it('matches the list view\'s day headers across a month change', () => {
    expect(dayLabels('2026-11-30')).toEqual(['30 novembre 2026', '1 décembre 2026', '2 décembre 2026', '3 décembre 2026', '4 décembre 2026', '5 décembre 2026', '6 décembre 2026']);
  });
});
