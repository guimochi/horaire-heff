import { describe, expect, it } from 'vitest';
import { notificationFor, pushTtl } from '../../src/sync/notify-text';
import type { Change, ChangeKind, Course } from '../../src/shared/types';

const NOW = new Date('2026-11-23T09:40:00+01:00'); // lundi
const SAT = new Date('2026-11-21T10:00:00+01:00'); // mardi 24 = 3 jours
const url = '/#/changements';
const c = (o: Partial<Course>): Course => ({ date: '2026-11-26', start: '10:00', end: '12:00', subject: 'AFP 3',
  teacher: '', room: '', group: '', cancelled: false, extra: [], ...o });
const ch = (kind: ChangeKind, before: Course | null, after: Course | null): Change =>
  ({ id: 'x', kind, promo: 'p', detectedAt: '', before, after });

describe('notificationFor', () => {
  it('annule', () => {
    const k = c({ subject: 'Act. gymniques 5', date: '2026-11-23', start: '13:00', end: '15:00' });
    expect(notificationFor([ch('annule', k, null)], NOW)).toEqual({ title: 'Cours annulé',
      body: "Act. gymniques 5 · aujourd'hui 13:00 n'aura pas lieu.", url });
  });
  it('local', () => {
    expect(notificationFor([ch('local', c({ room: '1.0.07' }), c({ room: '2.1.04' }))], NOW)).toEqual({
      title: 'Changement de local', body: 'AFP 3 · jeudi 10:00 → local 2.1.04 (au lieu de 1.0.07).', url });
  });
  it('local_with_empty_rooms', () => {
    expect(notificationFor([ch('local', c({}), c({ room: '2.1.04' }))], NOW)?.body).toBe('AFP 3 · jeudi 10:00 → local 2.1.04.');
    expect(notificationFor([ch('local', c({ room: '1.0.07' }), c({}))], NOW)?.body)
      .toBe('AFP 3 · jeudi 10:00 → local non précisé (au lieu de 1.0.07).');
  });
  it('enseignant_added_omits_empty_before', () => {
    expect(notificationFor([ch('enseignant', c({}), c({ teacher: 'Dupont Marie' }))], NOW)?.body).toBe('AFP 3 · jeudi 10:00 · avec Dupont Marie.');
  });
  it('horaire', () => {
    const b = c({ subject: 'Physiologie 5', date: '2026-11-24', start: '13:00', end: '17:00' });
    expect(notificationFor([ch('horaire', b, { ...b, start: '14:00' })], SAT)).toEqual({
      title: 'Horaire modifié', body: 'Physiologie 5 · mardi : 14:00–17:00 (au lieu de 13:00–17:00).', url });
  });
  it('ajoute', () => {
    const a = c({ subject: 'Sports et jeux', start: '13:30', end: '16:30', room: 'Sport 6 TC' });
    expect(notificationFor([ch('ajoute', null, a)], NOW)).toEqual({
      title: 'Cours ajouté', body: 'Sports et jeux · jeudi 13:30–16:30 · Sport 6 TC.', url });
  });
  it('un-cancelled course is rétabli', () => {
    expect(notificationFor([ch('ajoute', c({ cancelled: true }), c({}))], NOW)?.title).toBe('Cours rétabli');
  });
  it('grouped names the day of each change', () => {
    const l = [ch('annule', c({ date: '2026-11-23', end: '23:00' }), null), ch('annule', c({ subject: 'Physio', date: '2026-12-10' }), null)];
    expect(notificationFor(l, NOW)?.body).toBe("AFP 3 · aujourd'hui, Physio · jeudi 10 déc.");
  });
  it('ajoute without room omits it', () => {
    expect(notificationFor([ch('ajoute', null, c({ subject: 'Sports et jeux', start: '13:30', end: '16:30' }))], NOW)?.body)
      .toBe('Sports et jeux · jeudi 13:30–16:30.');
  });
  it('deplace', () => {
    const b = c({ subject: 'Physiologie 5', date: '2026-11-24', start: '13:00', end: '17:00' });
    expect(notificationFor([ch('deplace', b, { ...b, date: '2026-11-26', start: '10:00', end: '14:00' })], SAT)).toEqual({
      title: 'Cours déplacé', body: 'Physiologie 5 · mardi 13:00 → jeudi 10:00.', url });
  });
  it('enseignant', () => {
    expect(notificationFor([ch('enseignant', c({ teacher: 'Leroy Anne' }), c({ teacher: 'Dupont Marie' }))], NOW)).toEqual({
      title: 'Enseignant modifié', body: 'AFP 3 · jeudi 10:00 · avec Dupont Marie (au lieu de Leroy Anne).', url });
  });
  it('enseignant removed', () => {
    expect(notificationFor([ch('enseignant', c({ teacher: 'Leroy Anne' }), c({}))], NOW)?.body)
      .toBe('AFP 3 · jeudi 10:00 · sans enseignant (au lieu de Leroy Anne).');
  });
  it('autre', () => {
    expect(notificationFor([ch('autre', c({}), c({ extra: ['Mémo = salle B'] }))], NOW)).toEqual({
      title: 'Cours modifié', body: 'AFP 3 · jeudi 10:00 · Mémo = salle B', url });
    expect(notificationFor([ch('autre', c({ group: 'A' }), c({ group: 'B' }))], NOW)?.body).toBe('AFP 3 · jeudi 10:00 · détails mis à jour.');
  });
  it('past_course_change_is_ignored', () => {
    const past = c({ date: '2026-11-23', start: '08:00', end: '09:30' });
    expect(notificationFor([ch('annule', past, null)], NOW)).toBeNull();
  });
  it('past dropped before counting', () => {
    const past = c({ date: '2026-11-23', start: '08:00', end: '09:30' });
    expect(notificationFor([ch('annule', past, null), ch('autre', c({}), c({}))], NOW)?.title).toBe('Cours modifié');
  });
  it('grouped_three', () => {
    const a = c({ subject: 'Act. gymniques 5' }), b = c({ subject: 'AFP 3' }), p = c({ subject: 'Physiologie 5' });
    expect(notificationFor([ch('annule', a, null), ch('annule', b, null), ch('annule', p, null)], NOW)).toEqual({
      title: '3 changements dans ton horaire', body: 'Act. gymniques 5 · jeudi, AFP 3 · jeudi, Physiologie 5 · jeudi', url });
  });
  it('grouped distinct subjects, truncated after 3', () => {
    const l = ['A', 'A', 'B', 'C', 'D'].map((s) => ch('annule', c({ subject: s }), null));
    expect(notificationFor(l, NOW)).toEqual({ title: '5 changements dans ton horaire', body: 'A · jeudi, B · jeudi, C · jeudi…', url });
  });
  it('relative_day_rules', () => {
    const body = (date: string) => notificationFor([ch('annule', c({ date }), null)], NOW)?.body;
    expect(body('2026-11-23')).toBe("AFP 3 · aujourd'hui 10:00 n'aura pas lieu.");
    expect(body('2026-11-24')).toBe('AFP 3 · demain 10:00 n\'aura pas lieu.');
    expect(body('2026-11-29')).toBe("AFP 3 · dimanche 10:00 n'aura pas lieu.");
    expect(body('2026-11-30')).toBe("AFP 3 · lundi 30 nov. 10:00 n'aura pas lieu.");
    expect(body('2026-12-01')).toBe("AFP 3 · mardi 1 déc. 10:00 n'aura pas lieu.");
  });
});

describe('pushTtl', () => {
  it('push_ttl_until_latest_course_end_capped', () => {
    const at = (date: string, end: string) => ch('annule', c({ date, start: '08:00', end }), null);
    // NOW = lundi 09:40 Bruxelles: 10:00 ends in 20 min, 12:00 in 2 h 20.
    expect(pushTtl([at('2026-11-23', '10:00'), at('2026-11-23', '12:00')], NOW)).toBe(140 * 60);
    expect(pushTtl([at('2026-11-26', '12:00')], NOW)).toBe(43200);
    expect(pushTtl([at('2026-11-23', '09:40')], NOW)).toBe(60);
  });
});
