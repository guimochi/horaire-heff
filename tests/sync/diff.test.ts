import { describe, it, expect } from 'vitest';
import { diffSnapshots } from '../../src/sync/diff';
import type { Course, Snapshot } from '../../src/shared/types';

const base: Course = { date: '2026-11-24', start: '13:00', end: '15:00', subject: 'Diff des apprentissages',
  teacher: 'Dupont', room: '1.0.07', group: '', cancelled: false, extra: [] };
const c = (o: Partial<Course> = {}): Course => ({ ...base, ...o });
const snap = (courses: Course[], weeks = ['2026-11-23']): Snapshot => ({ promo: 'P', fetchedAt: 'x', weeks, courses });
const run = (a: Course[], b: Course[]) => diffSnapshots(snap(a), snap(b), 'T');

describe('diffSnapshots', () => {
  it('identical_snapshots_yield_no_change', () => expect(run([c()], [c()])).toEqual([]));
  it('room_change_yields_local', () => {
    const r = run([c()], [c({ room: '2.1.04' })]);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('local');
    expect(r[0].before!.room).toBe('1.0.07');
    expect(r[0].after!.room).toBe('2.1.04');
  });
  it('time_change_yields_horaire', () => {
    const r = run([c()], [c({ start: '14:00' })]);
    expect(r.map((x) => x.kind)).toEqual(['horaire']);
  });
  it('room_and_time_change_yield_two_changes', () => {
    const r = run([c()], [c({ start: '14:00', room: '2.1.04' })]);
    expect(r.map((x) => x.kind)).toEqual(['horaire', 'local']);
  });
  it('teacher_and_extra_changes', () => {
    const r = run([c()], [c({ teacher: 'Martin', extra: ['Mémo x'] })]);
    expect(r.map((x) => x.kind)).toEqual(['autre', 'enseignant']);
  });
  it('disappeared_course_yields_annule', () => {
    const r = run([c()], []);
    expect(r.map((x) => x.kind)).toEqual(['annule']);
    expect(r[0].after).toBeNull();
    expect(r[0].id).toBe('annule|2026-11-24|Diff des apprentissages||13:00|T');
  });
  it('cancelled_flag_yields_annule', () => {
    const r = run([c()], [c({ cancelled: true })]);
    expect(r.map((x) => x.kind)).toEqual(['annule']);
  });
  it('uncancelled_yields_ajoute', () => {
    expect(run([c({ cancelled: true })], [c()]).map((x) => x.kind)).toEqual(['ajoute']);
  });
  it('already_cancelled_disappearing_or_appearing_is_silent', () => {
    expect(run([c({ cancelled: true })], [])).toEqual([]);
    expect(run([], [c({ cancelled: true })])).toEqual([]);
  });
  it('new_course_yields_ajoute', () => {
    expect(run([], [c()]).map((x) => x.kind)).toEqual(['ajoute']);
  });
  it('same_subject_twice_same_day_pairs_chronologically', () => {
    const r = run([c({ start: '08:00', end: '10:00' }), c({ start: '14:00' })],
      [c({ start: '08:00', end: '10:00' }), c({ start: '15:00' })]);
    expect(r.map((x) => x.kind)).toEqual(['horaire']);
    expect(r[0].before!.start).toBe('14:00');
    expect(r[0].after!.start).toBe('15:00');
  });
  it('same_subject_twice_empty_group_pairs_chronologically', () => {
    const a = c({ date: '2026-11-25', subject: 'Athlétisme 4', start: '08:30', end: '10:30', room: 'S1' });
    const b = c({ date: '2026-11-25', subject: 'Athlétisme 4', start: '10:30', end: '12:30', room: 'S2' });
    expect(run([a, b], [a, b])).toEqual([]);
    const r = run([b, a], [{ ...b, room: 'S3' }, a]);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('local');
    expect(r[0].after!.start).toBe('10:30');
  });
  it('moved_to_other_day_same_week_yields_deplace', () => {
    const r = run([c()], [c({ date: '2026-11-26', start: '10:00', end: '12:00' })]);
    expect(r.map((x) => x.kind)).toEqual(['deplace']);
    expect(r[0].before!.date).toBe('2026-11-24');
    expect(r[0].after!.date).toBe('2026-11-26');
  });
  it('cancelled_flag_annule_is_not_merged_into_deplace', () => {
    const r = run([c()], [c({ cancelled: true }), c({ date: '2026-11-26' })]);
    expect(r.map((x) => x.kind).sort()).toEqual(['ajoute', 'annule']);
  });
  it('no_deplace_across_weeks', () => {
    const r = diffSnapshots(snap([c()], ['2026-11-23', '2026-11-30']),
      snap([c({ date: '2026-12-01' })], ['2026-11-23', '2026-11-30']), 'T');
    expect(r.map((x) => x.kind).sort()).toEqual(['ajoute', 'annule']);
  });
  it('new_week_in_window_yields_nothing', () => {
    const week2 = [1, 2, 3, 4, 5].map((d) => c({ date: '2026-11-30', start: `0${d}:00` }));
    const r = diffSnapshots(snap([c()]), snap([c(), ...week2], ['2026-11-23', '2026-11-30']), 'T');
    expect(r).toEqual([]);
  });
  it('week_leaving_window_yields_nothing', () => {
    const old = c({ date: '2026-11-30' });
    const r = diffSnapshots(snap([c(), old], ['2026-11-23', '2026-11-30']), snap([c()]), 'T');
    expect(r).toEqual([]);
  });
  it('twin_changes_have_unique_ids', () => {
    const a = c({ date: '2026-11-25', subject: 'Athlétisme 4', start: '08:30', end: '10:30' });
    const b = c({ date: '2026-11-25', subject: 'Athlétisme 4', start: '10:30', end: '12:30' });
    const r = run([a, b], [{ ...a, room: 'X' }, { ...b, room: 'Y' }]);
    expect(r).toHaveLength(2);
    expect(new Set(r.map((x) => x.id)).size).toBe(2);
  });
  it('added_twin_before_existing_does_not_fake_horaire', () => {
    const r = run([c({ start: '10:30', end: '12:30' })], [c({ start: '08:30', end: '10:30' }), c({ start: '10:30', end: '12:30' })]);
    expect(r.map((x) => x.kind)).toEqual(['ajoute']);
    expect(r[0].after!.start).toBe('08:30');
  });
  it('group_only_change_yields_autre', () => {
    const r = run([c({ group: '3 EDP' })], [c({ group: '3 EDP, 3 SC' })]);
    expect(r.map((x) => x.kind)).toEqual(['autre']);
    expect(r[0].before!.group).toBe('3 EDP');
    expect(r[0].after!.group).toBe('3 EDP, 3 SC');
    // Other start: still a move, not a regroup.
    expect(run([c({ group: 'A' })], [c({ group: 'B', start: '15:00' })]).map((x) => x.kind).sort()).toEqual(['ajoute', 'annule']);
  });
  it('regroup_needs_same_end', () => {
    // Same start and subject under another group, but another end: two courses, not one edited course.
    expect(run([c({ group: 'A' })], [c({ group: 'B', end: '16:00' })]).map((x) => x.kind).sort()).toEqual(['ajoute', 'annule']);
  });
  it('cancelled_and_room_changed_yields_only_annule', () => {
    expect(run([c()], [c({ cancelled: true, room: 'Z' })]).map((x) => x.kind)).toEqual(['annule']);
    expect(run([c({ cancelled: true })], [c({ cancelled: true, room: 'Z' })])).toEqual([]);
  });
});
