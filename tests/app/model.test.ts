import { describe, expect, it } from 'vitest';
import type { Change, Course, Snapshot } from '../../src/shared/types';
import { bannerText, changeCard, changesModel, clearStamp, keepPick, seenStamp, dayModel, defaultWeek, emptyDaysText, endsIn, freshness, relTime, splitSeen, tags, weekModel,
  weekRange } from '../../src/app/model';

// Mockup week (design/Main|Week|Changes.dc.html), BA3 - S3 - EPS, 23 Nov 2026.
const c = (date: string, start: string, end: string, subject: string, room: string, teacher = '', cancelled = false): Course =>
  ({ date, start, end, subject, teacher, room, group: '3 EDP', cancelled, extra: [] });

const COURSES: Course[] = [
  c('2026-11-23', '08:00', '11:00', 'Diff des apprentissages', '3.1.01', 'Leroy Anne'),
  c('2026-11-23', '13:00', '16:00', 'Act. gymniques 5', 'Gymnase Buls', 'Lambert Paul', true),
  c('2026-11-24', '09:00', '12:00', 'Sports et jeux', 'Bolingo'),
  c('2026-11-24', '14:00', '17:00', 'Physiologie 5', '3.2.01'),
  c('2026-11-25', '10:00', '12:00', 'Élaboration projet prof', '3.1.01'),
  c('2026-11-25', '14:00', '17:00', 'Diff des apprentissages', '3.1.01'),
  c('2026-11-26', '08:00', '10:00', 'Sports individuels', 'Gymnase Buls'),
  c('2026-11-26', '10:00', '12:00', 'AFP 3', '2.1.04'),
  c('2026-11-26', '13:30', '16:30', 'Sports et jeux', 'Sport 6 TC'),
  c('2026-11-30', '08:00', '11:00', 'Diff des apprentissages', '3.1.01'),
];
const SNAP: Snapshot = { promo: 'BA3 - S3 - EPS', fetchedAt: '2026-11-23T08:36:00.000Z', weeks: ['2026-11-23', '2026-11-30'], courses: COURSES };

const ch = (id: string, kind: Change['kind'], detectedAt: string, before: Course | null, after: Course | null): Change =>
  ({ id, kind, promo: SNAP.promo, detectedAt, before, after });
const gym = COURSES[1], physio = COURSES[3], afp = COURSES[7], sej = COURSES[8];
const CHANGES: Change[] = [
  ch('a', 'annule', '2026-11-23T08:28:00.000Z', { ...gym, cancelled: false }, gym),
  ch('l', 'local', '2026-11-23T08:28:00.000Z', { ...afp, room: '1.0.07' }, afp),
  ch('h', 'horaire', '2026-11-22T17:40:00.000Z', { ...physio, start: '13:00' }, physio),
  ch('j', 'ajoute', '2026-11-19T10:05:00.000Z', null, sej),
];
const NOW = new Date('2026-11-23T08:40:00Z'); // lun. 23/11 09:40 Brussels

describe('dayModel', () => {
  it('current_pause_cancelled_banner_and_changed_dates', () => {
    const m = dayModel(SNAP, CHANGES, '2026-11-23', NOW);
    expect(m.items.map((i) => (i.kind === 'pause' ? `pause ${i.from}-${i.to}` : `${i.course.subject} ${i.status}`))).toEqual([
      'Diff des apprentissages en-cours', 'pause 11:00-13:00', 'Act. gymniques 5 annule',
    ]);
    const first = m.items[0];
    expect(first.kind === 'course' && first.progress).toBeCloseTo(0.556, 3);
    expect(m.banner?.kind).toBe('annule');
    expect(m.changedDates).toContain('2026-11-26');
    expect(m.changedDates).toContain('2026-11-24');
  });

  it('empty_day_has_next_course', () => {
    const m = dayModel(SNAP, CHANGES, '2026-11-29', new Date('2026-11-29T10:00:00Z')); // Sunday 11:00
    expect(m.items).toEqual([]);
    expect(m.nextCourse?.date).toBe('2026-11-30');
    expect(m.banner).toBeNull();
  });

  it('next_course_is_after_now_not_after_the_selected_date', () => {
    // Past empty day (Sun 22) seen on Mon 09:40: Diff 08:00 has started and Act. gym. is cancelled → Tue 09:00.
    const m = dayModel(SNAP, CHANGES, '2026-11-22', NOW);
    expect(m.nextCourse && `${m.nextCourse.date} ${m.nextCourse.start}`).toBe('2026-11-24 09:00');
  });

  it('short_gap_is_not_a_pause', () => {
    const s = { ...SNAP, courses: [c('2026-11-27', '08:00', '10:00', 'A', ''), c('2026-11-27', '10:15', '12:00', 'B', '')] };
    expect(dayModel(s, [], '2026-11-27', NOW).items.map((i) => i.kind)).toEqual(['course', 'course']);
  });

  it('past_and_upcoming_statuses_and_tags', () => {
    const m = dayModel(SNAP, CHANGES, '2026-11-26', new Date('2026-11-26T10:00:00Z')); // 11:00 Brussels
    const st = m.items.flatMap((i) => (i.kind === 'course' ? [[i.course.subject, i.status, i.changedKinds.join()]] : []));
    expect(st).toEqual([['Sports individuels', 'passe', ''], ['AFP 3', 'en-cours', 'local'], ['Sports et jeux', 'a-venir', 'ajoute']]);
    expect(m.banner?.kind).toBe('local');
  });
});

describe('vanished courses (R22)', () => {
  const gone = c('2026-11-25', '08:00', '09:45', 'Natation 2', 'Piscine'); // 15-min gap before 10:00: no pause
  const vanished = ch('v', 'annule', '2026-11-23T08:00:00.000Z', gone, null);

  it('vanished_course_shows_as_annule_in_day', () => {
    const m = dayModel(SNAP, [vanished, ...CHANGES], '2026-11-25', NOW);
    expect(m.items.map((i) => (i.kind === 'pause' ? 'pause' : `${i.course.start} ${i.course.subject} ${i.status} ${i.course.cancelled}`))).toEqual([
      '08:00 Natation 2 annule true', '10:00 Élaboration projet prof a-venir false', 'pause', '14:00 Diff des apprentissages a-venir false',
    ]);
    const first = m.items[0];
    expect(first.kind === 'course' && tags(first)).toEqual(['Annulé']);
    const wed = weekModel(SNAP, [vanished], '2026-11-23', NOW).days.find((d) => d.date === '2026-11-25')!;
    expect(wed.items.map((i) => i.kind === 'course' && i.course.subject)).toEqual(['Natation 2', 'Élaboration projet prof', 'Diff des apprentissages']);
    // Ghost alone on an otherwise empty day: the day is no longer empty.
    const sat = ch('s', 'annule', '2026-11-23T08:00:00.000Z', c('2026-11-28', '09:00', '11:00', 'Stage', ''), null);
    expect(weekModel(SNAP, [sat], '2026-11-23', NOW).emptyDays).toEqual(['2026-11-27']);
  });

  it('vanished_course_reappeared_is_not_ghosted', () => {
    const back = ch('b', 'ajoute', '2026-11-23T08:30:00.000Z', null, { ...gone, start: '08:30', end: '10:00' });
    const s = { ...SNAP, courses: [...COURSES, back.after!] };
    const subjects = (m: ReturnType<typeof dayModel>) => m.items.flatMap((i) => (i.kind === 'course' ? [`${i.course.start} ${i.course.subject}`] : []));
    expect(subjects(dayModel(s, [back, vanished], '2026-11-25', NOW))).toEqual(['08:30 Natation 2', '10:00 Élaboration projet prof', '14:00 Diff des apprentissages']);
    const moved = ch('m', 'deplace', '2026-11-23T08:30:00.000Z', c('2026-11-24', '08:00', '09:30', 'Natation 2', ''), back.after);
    expect(subjects(dayModel(s, [moved, vanished], '2026-11-25', NOW))[0]).toBe('08:30 Natation 2');
    // Same course still in the snapshot (same date, subject, group, start): no duplicate.
    const present = ch('p', 'annule', '2026-11-23T08:00:00.000Z', COURSES[4], null);
    expect(subjects(dayModel(SNAP, [present], '2026-11-25', NOW))).toEqual(['10:00 Élaboration projet prof', '14:00 Diff des apprentissages']);
  });
});

describe('ghosts', () => {
  it('group_change_leaves_no_ghost', () => {
    // Older feed (before the diff paired regroups): annule + ajoute from the same run, new group in the snapshot.
    const old = COURSES[4], regrouped = { ...old, group: '3 EDP, 3 SC' };
    const s = { ...SNAP, courses: COURSES.map((x) => (x === old ? regrouped : x)) };
    const feed = [ch('g1', 'annule', '2026-11-23T08:00:00.000Z', old, null), ch('g2', 'ajoute', '2026-11-23T08:00:00.000Z', null, regrouped)];
    const m = dayModel(s, feed, '2026-11-25', NOW);
    expect(m.items.flatMap((i) => (i.kind === 'course' ? [`${i.course.start} ${i.course.subject} ${i.status}`] : [])))
      .toEqual(['10:00 Élaboration projet prof a-venir', '14:00 Diff des apprentissages a-venir']);
  });
});

describe('weekModel', () => {
  it('days_and_empty_days', () => {
    const m = weekModel(SNAP, CHANGES, '2026-11-23', NOW);
    expect(m.emptyDays).toEqual(['2026-11-27', '2026-11-28']);
    expect(m.days.map((d) => d.label)).toEqual(["Lundi 23 · aujourd'hui", 'Mardi 24', 'Mercredi 25', 'Jeudi 26']);
    expect(m.days.every((d) => d.items.every((i) => i.kind === 'course'))).toBe(true);
    expect(emptyDaysText(m.emptyDays)).toBe('Vendredi 27 et samedi 28 · pas de cours');
  });

  it('default_week_and_range', () => {
    expect(defaultWeek(SNAP, NOW)).toBe('2026-11-23');
    expect(defaultWeek(SNAP, new Date('2026-11-29T10:00:00Z'))).toBe('2026-11-30'); // Sunday → next week
    expect(weekRange('2026-11-23')).toBe('23 – 28 novembre');
    expect(weekRange('2026-11-30')).toBe('30 nov. – 5 déc.');
  });
});

describe('changesModel', () => {
  const t = (h: number) => `2026-11-23T0${h}:00:00.000Z`;
  const list = [ch('3', 'local', t(3), afp, afp), ch('2', 'local', t(2), afp, afp), ch('1', 'local', t(1), afp, afp)];

  it('cleared_at_filters_older', () => {
    expect(changesModel(list, '2026-11-23T01:30:00.000Z', null).visible.map((x) => x.id)).toEqual(['3', '2']);
  });
  it('unread_after_max_of_cleared_and_seen', () => {
    expect(changesModel(list, null, null).unread).toBe(3);
    expect(changesModel(list, '2026-11-23T01:30:00.000Z', null).unread).toBe(2);
    expect(changesModel(list, '2026-11-23T01:30:00.000Z', '2026-11-23T02:30:00.000Z').unread).toBe(1);
    expect(changesModel(list, '2026-11-23T02:30:00.000Z', '2026-11-23T01:30:00.000Z').unread).toBe(1);
  });
  it('seen_uses_newest_loaded_detectedAt', () => {
    expect(seenStamp(list)).toBe(t(3));
    expect(seenStamp([])).toBeNull();
    // Marked seen at T3 by server time; a change detected at T3+1 min that lands later is still unread.
    const late = ch('4', 'local', '2026-11-23T03:01:00.000Z', afp, afp);
    expect(changesModel([late, ...list], null, seenStamp(list)).unread).toBe(1);
  });
  it('clear_stamp_is_newest_visible_detectedAt', () => {
    expect(clearStamp(list)).toBe(t(3));
  });
  it('split_uses_seen_before_open', () => {
    const s = splitSeen(CHANGES, '2026-11-20T00:00:00.000Z');
    expect(s.fresh.map((x) => x.id)).toEqual(['a', 'l', 'h']);
    expect(s.earlier.map((x) => x.id)).toEqual(['j']);
  });
});

describe('copy', () => {
  it('relative_times', () => {
    expect(relTime('2026-11-23T08:28:00.000Z', NOW)).toBe('il y a 12 min');
    expect(relTime('2026-11-22T17:40:00.000Z', NOW)).toBe('hier, 18:40');
    expect(relTime('2026-11-19T10:05:00.000Z', NOW)).toBe('jeu. 19 nov.');
  });
  it('ends_in', () => {
    expect(endsIn(COURSES[0], NOW)).toBe('Fin dans 1 h 20');
    expect(endsIn(COURSES[0], new Date('2026-11-23T09:45:00Z'))).toBe('Fin dans 15 min');
  });
});

describe('change copy per kind (controller ruling)', () => {
  const at = '2026-11-23T08:28:00.000Z';
  const moved = { ...afp, date: '2026-11-27', start: '13:00', end: '15:00' };
  it.each<[string, Change, Record<string, string | undefined>]>([
    ['annule', CHANGES[0], { label: 'Cours annulé', title: 'Act. gymniques 5', detail: 'Lundi 23 nov. · 13:00 – 16:00 · Gymnase Buls' }],
    ['annule_vanished_no_room', ch('x', 'annule', at, { ...gym, room: '' }, null), { label: 'Cours annulé', detail: 'Lundi 23 nov. · 13:00 – 16:00' }],
    ['local', CHANGES[1], { label: 'Local modifié', title: 'AFP 3 · jeudi 26 nov., 10:00', from: '1.0.07', to: '2.1.04' }],
    ['local_empty_room', ch('x', 'local', at, { ...afp, room: '' }, afp), { from: 'sans local', to: '2.1.04' }],
    ['horaire', CHANGES[2], { label: 'Horaire modifié', title: 'Physiologie 5 · mardi 24 nov.', from: '13:00 – 17:00', to: '14:00 – 17:00' }],
    ['ajoute', CHANGES[3], { label: 'Cours ajouté', title: 'Sports et jeux · jeudi 26 nov., 13:30', from: undefined }],
    ['deplace', ch('x', 'deplace', at, afp, moved), { label: 'Cours déplacé', title: 'AFP 3', from: 'jeudi 26 nov., 10:00', to: 'vendredi 27 nov., 13:00' }],
    ['enseignant', ch('x', 'enseignant', at, { ...afp, teacher: 'A' }, { ...afp, teacher: '' }),
      { label: 'Enseignant modifié', from: 'A', to: 'sans enseignant' }],
    ['autre', ch('x', 'autre', at, afp, { ...afp, extra: ['Mémo = salle B'] }), { label: 'Cours modifié', detail: 'Mémo = salle B' }],
  ])('%s', (_, change, want) => {
    const got = changeCard(change) as Record<string, unknown>;
    for (const [k, v] of Object.entries(want)) expect(got[k]).toBe(v);
  });

  it('every_kind_has_icon_and_label', () => {
    for (const k of ['annule', 'ajoute', 'horaire', 'local', 'enseignant', 'deplace', 'autre'] as const) {
      const v = changeCard(ch('x', k, at, afp, afp));
      expect(v.icon).toBeTruthy();
      expect(v.label).toBeTruthy();
    }
  });

  it('banner_copy', () => {
    expect(bannerText(CHANGES[0], '2026-11-23', NOW)).toMatchObject({ strong: 'Act. gymniques 5 est annulé', rest: 'cet après\u2011midi', tone: 'cancelled' });
    expect(bannerText(CHANGES[1], '2026-11-26', NOW)).toMatchObject({ strong: 'AFP 3 change de local', rest: ': 2.1.04', tone: 'modified' });
    const d = ch('x', 'deplace', at, afp, { ...afp, date: '2026-11-27', start: '13:00' });
    expect(bannerText(d, '2026-11-26', NOW).rest).toBe('au vendredi 27 à 13:00');
    expect(bannerText(d, '2026-11-27', NOW).rest).toBe('ici (avant : jeudi 26 à 10:00)');
  });

  it('tags_never_color_alone', () => {
    const m = dayModel(SNAP, CHANGES, '2026-11-23', NOW);
    const [cur, , off] = m.items;
    expect(cur.kind === 'course' && tags(cur)).toEqual([]);
    expect(off.kind === 'course' && tags(off)).toEqual(['Annulé']);
    const thu = weekModel(SNAP, CHANGES, '2026-11-23', NOW).days[3].items[1];
    expect(thu.kind === 'course' && tags(thu)).toEqual(['Local']);
  });
});

describe('freshness (R20)', () => {
  it('uses_last_success', () => {
    expect(freshness(SNAP, '2026-11-23T08:36:00.000Z', NOW)).toEqual({ updated: 'Mis à jour il y a 4 min', stale: false });
  });
  it('falls_back_to_fetched_at', () => {
    expect(freshness({ ...SNAP, fetchedAt: '2026-11-23T08:30:00.000Z' }, null, NOW).updated).toBe('Mis à jour il y a 10 min');
  });
  it('stale_when_a_read_was_missed', () => {
    const f = freshness(SNAP, '2026-11-23T05:00:00.000Z', NOW); // 06:00 Brussels; 06:30 read missed by > 1 h
    expect(f.stale).toBe(true);
    expect(f.updated).toBe("Mis à jour aujourd'hui, 06:00");
  });
  it('old_date_reads_le', () => {
    expect(freshness(SNAP, '2026-11-19T10:05:00.000Z', NOW).updated).toBe('Mis à jour le jeu. 19 nov.');
  });
});

describe('keepPick (resume on another day)', () => {
  it('drops_a_pick_made_on_an_earlier_day', () => {
    expect(keepPick({ value: '2026-11-26', on: '2026-11-23' }, NOW)).toBe('2026-11-26');
    expect(keepPick({ value: '2026-11-26', on: '2026-11-23' }, new Date('2026-11-24T07:00:00Z'))).toBeNull();
    expect(keepPick(null, NOW)).toBeNull();
  });
});
