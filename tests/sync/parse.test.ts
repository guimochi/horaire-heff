import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCourse, type RawCourse } from '../../src/sync/parse';
import { mondayOf } from '../../src/shared/time';

const raw = { aria: 'Cours du 23 novembre de 8 heures 00 à 11 heures 00',
  lines: ['Diff des apprentissages', 'Leroy Anne', 'BA3 - S3 - EPS', '3.1.01'], cancelledMarker: false };

describe('parseCourse', () => {
  it('parses aria and lines', () => {
    expect(parseCourse(raw, '2026-11-23')).toEqual({ date: '2026-11-23', start: '08:00', end: '11:00',
      subject: 'Diff des apprentissages', teacher: 'Leroy Anne', group: 'BA3 - S3 - EPS', room: '3.1.01', cancelled: false, extra: [] });
  });
  it('rolls the year over (passage d\'année)', () => {
    expect(parseCourse({ ...raw, aria: 'Cours du 2 janvier de 13 heures 30 à 16 heures 30' }, '2026-12-28').date).toBe('2027-01-02');
    expect(parseCourse({ ...raw, aria: 'Cours du 2 janvier de 13 heures 30 à 16 heures 30' }, '2026-12-28').start).toBe('13:30');
  });
  it('missing teacher: the group line is the anchor', () => {
    expect(parseCourse({ ...raw, lines: ['AFP 3', 'BA3 - S3 - EPS', '1.0.07'] }, '2026-11-23')).toMatchObject({ teacher: '', room: '1.0.07' });
  });
  it('cancelled marker', () => {
    expect(parseCourse({ ...raw, cancelledMarker: true }, '2026-11-23').cancelled).toBe(true);
  });
  it('accepts "1er"', () => {
    expect(parseCourse({ ...raw, aria: 'Cours du 1er décembre de 8 heures 00 à 9 heures 30' }, '2026-11-30')).toMatchObject({ date: '2026-12-01', start: '08:00', end: '09:30' });
  });
  it('throws on an unknown aria', () => {
    expect(() => parseCourse({ ...raw, aria: 'Cours du 23 brumaire de 8 heures 00 à 11 heures 00' }, '2026-11-23')).toThrow();
    expect(() => parseCourse({ ...raw, aria: 'Réunion' }, '2026-11-23')).toThrow();
  });

  // Real grid shapes (BA3 - S3 - EPS, 2026-11-23): group lines are known group names, not always " - ".
  const groups = ['3 EDP', 'BA3 - S3 - FEPC', 'BA3 - S3 - FFLE', 'BA3 - S3 - SH'];
  it('known group names are the anchor', () => {
    expect(parseCourse({ ...raw, lines: ['Diff des apprentissages', 'Leroy Anne', '3 EDP', '3.1.01'] }, '2026-11-23', groups))
      .toMatchObject({ teacher: 'Leroy Anne', group: '3 EDP', room: '3.1.01', extra: [] });
  });
  it('no group: subject, teacher, room', () => {
    expect(parseCourse({ ...raw, lines: ['Athlétisme 4', 'Van Acker Marc', 'Gymnase Buls'] }, '2026-11-23', groups))
      .toMatchObject({ subject: 'Athlétisme 4', teacher: 'Van Acker Marc', group: '', room: 'Gymnase Buls', extra: [] });
  });
  it('memo goes to extra, never to room', () => {
    expect(parseCourse({ ...raw, lines: ['Sports et jeux', 'Moreau Hugo', '3 EDP', 'Mémo // Sport 6 TC'] }, '2026-11-23', groups))
      .toMatchObject({ teacher: 'Moreau Hugo', group: '3 EDP', room: '', extra: ['Mémo // Sport 6 TC'] });
  });
  it('several rooms are joined', () => {
    expect(parseCourse({ ...raw, lines: ['AFP1 /AFP2 /AFP3', 'Lemaire Alain', 'Renard Hélène', '3 EDP', '1.2.07', '1.2.11 - Local Levillez'] }, '2026-12-07', groups))
      .toMatchObject({ teacher: 'Lemaire Alain, Renard Hélène', group: '3 EDP', room: '1.2.07, 1.2.11 - Local Levillez', extra: [] });
  });
  // No group line: the list view's Enseignant names split teachers from rooms (grid lines carry no hint).
  it('no group, two teachers: the second is a teacher, not a room', () => {
    expect(parseCourse({ ...raw, lines: ['AFP 1', 'Leroy Anne', 'Renard Hélène', '1.1.06'] }, '2026-11-23', groups, ['Renard Hélène', 'Leroy Anne']))
      .toMatchObject({ teacher: 'Leroy Anne, Renard Hélène', room: '1.1.06', group: '' });
  });
  it('no group, room without a digit', () => {
    expect(parseCourse({ ...raw, lines: ['Natation 2', 'Leroy Anne', 'Simon Louis', 'Bain Bruxelles'] }, '2026-11-23', groups, ['Leroy Anne', 'Simon Louis']))
      .toMatchObject({ teacher: 'Leroy Anne, Simon Louis', room: 'Bain Bruxelles' });
  });
  it('no group, teachers only / room only', () => {
    expect(parseCourse({ ...raw, lines: ['AFP 1', 'Leroy Anne', 'Renard Hélène'] }, '2026-11-23', groups, ['Leroy Anne', 'Renard Hélène']))
      .toMatchObject({ teacher: 'Leroy Anne, Renard Hélène', room: '' });
    expect(parseCourse({ ...raw, lines: ['Stage', 'Gymnase Buls'] }, '2026-11-23', groups, []))
      .toMatchObject({ teacher: '', room: 'Gymnase Buls' });
  });
  it('several groups are joined', () => {
    expect(parseCourse({ ...raw, lines: ['I.A en éducation', 'Simon Louis', 'BA3 - S3 - FEPC', 'BA3 - S3 - FFLE', 'BA3 - S3 - SH', '1.1.05 (informatique)'] }, '2026-11-23', groups))
      .toMatchObject({ teacher: 'Simon Louis', group: 'BA3 - S3 - FEPC, BA3 - S3 - FFLE, BA3 - S3 - SH', room: '1.1.05 (informatique)' });
  });
});

type Fixture = { promo: string; weekLabel: string; weekStart: string; groups: string[]; courses: RawCourse[] };
const dir = new URL('../fixtures/', import.meta.url);
const files = readdirSync(dir).filter((f) => /^(courses-.*|cancelled)\.json$/.test(f));
const load = (f: string): Fixture => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));

describe('fixtures', () => {
  it('exist', () => {
    expect(files).toContain('cancelled.json');
    expect(files.filter((f) => f.startsWith('courses-')).length).toBeGreaterThanOrEqual(4);
  });
  for (const f of files) {
    it(f, () => {
      const fx = load(f);
      for (const r of fx.courses) {
        const c = parseCourse(r, fx.weekStart, fx.groups);
        expect(mondayOf(c.date)).toBe(fx.weekStart);
        expect(c.start < c.end).toBe(true);
        expect(c.subject).not.toBe('');
      }
    });
  }
  it('cancelled.json has a real cancelled course', () => {
    const fx = load('cancelled.json');
    const c = fx.courses.map((r) => parseCourse(r, fx.weekStart, fx.groups))
      .find((x) => x.date === '2026-10-06' && x.start === '09:00');
    expect(c).toMatchObject({ subject: 'Sports et jeux', teacher: 'Girard Julie', group: '3 EDP', room: 'Bolingo', cancelled: true });
    expect(fx.courses.filter((r) => r.cancelledMarker).length).toBe(1);
  });
  it('real captured shapes parse to the right fields', () => {
    const fx = load('courses-2026-11-23.json');
    const all = fx.courses.map((r) => parseCourse(r, fx.weekStart, fx.groups));
    const at = (date: string, start: string) => all.find((c) => c.date === date && c.start === start);
    expect(at('2026-11-23', '08:00')).toMatchObject({ subject: 'Diff des apprentissages', teacher: 'Leroy Anne', group: '3 EDP', room: '3.1.01', extra: [] });
    expect(at('2026-11-23', '16:00')).toMatchObject({ subject: 'Athlétisme 4', teacher: 'Van Acker Marc', group: '', room: 'Gymnase Buls' });
    expect(at('2026-11-26', '13:30')).toMatchObject({ subject: 'Sports et jeux', group: '3 EDP', room: '', extra: ['Mémo // Sport 6 TC'] });
    expect(at('2026-11-27', '10:00')?.group.split(', ').length).toBe(6);
    expect(at('2026-11-27', '10:00')?.room).toBe('1.1.05 (informatique)');
  });
});
