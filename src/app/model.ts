// Pure view models: every decision the screens show lives here, so the components only render.
import type { Change, ChangeKind, Course, Snapshot } from '../shared/types';
import { addDays, brusselsInstant, brusselsParts, DAYS, isStale, mins, mondayOf, MONTHS, MONTHS_SHORT, ref } from '../shared/time';

export type CourseStatus = 'passe' | 'en-cours' | 'a-venir' | 'annule';
export type DayItem = { kind: 'course'; course: Course; status: CourseStatus; progress: number /*0..1*/; changedKinds: ChangeKind[]; ghost?: boolean }
                    | { kind: 'pause'; from: string; to: string };

const PAUSE_MIN = 30;

const at = (date: string, hhmm: string) => brusselsInstant(date, mins(hhmm)).getTime();
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ymd = (date: string) => { const d = new Date(`${date}T00:00:00Z`); return { wd: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth() }; };
const time = (iso: string) => Date.parse(iso);
const sameCourse = (a: Course, b: Course) => a.date === b.date && a.start === b.start && a.subject === b.subject && a.group === b.group;
const byStart = (a: Course, b: Course) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end);

/** « lundi » */
export const weekday = (date: string) => DAYS[ymd(date).wd];
/** « Lundi 23 novembre » */
export const longDate = (date: string) => { const d = ymd(date); return `${cap(DAYS[d.wd])} ${d.day} ${MONTHS[d.month]}`; };
/** « lundi 23 nov. » */
export const shortDate = (date: string) => { const d = ymd(date); return `${DAYS[d.wd]} ${d.day} ${MONTHS_SHORT[d.month]}`; };
export const timeRange = (c: Course) => `${c.start} – ${c.end}`;
export const today = (now: Date) => brusselsParts(now).date;

function items(s: Snapshot, changes: Change[], date: string, now: Date, pauses: boolean): DayItem[] {
  const present = s.courses.filter((c) => c.date === date);
  // R22: a course that vanished is cancelled for her, unless it is still listed or a later ajoute/deplace brought it back.
  // Group left out: a regrouped course (same slot, other group) is still listed, not vanished.
  const listed = (a: Course, b: Course) => a.date === b.date && a.start === b.start && a.subject === b.subject;
  const sameSlot = (a: Course, b: Course) => a.date === b.date && a.subject === b.subject;
  const ghosts = changes
    .filter((c) => c.kind === 'annule' && c.after === null && c.before?.date === date)
    .filter((c) => !present.some((p) => listed(p, c.before!)))
    .filter((c) => !changes.some((d) => (d.kind === 'ajoute' || d.kind === 'deplace') && d.after && sameSlot(d.after, c.before!)
      && time(d.detectedAt) > time(c.detectedAt)))
    .map((c) => ({ ...c.before!, cancelled: true }));
  const ghostSet = new Set(ghosts.filter((g, i) => !ghosts.slice(0, i).some((h) => sameCourse(g, h))));
  const list = [...present, ...ghostSet].sort(byStart);
  const out: DayItem[] = [];
  let lastEnd = '';
  for (const course of list) {
    if (pauses && lastEnd && mins(course.start) - mins(lastEnd) >= PAUSE_MIN) out.push({ kind: 'pause', from: lastEnd, to: course.start });
    if (course.end > lastEnd) lastEnd = course.end;
    const t = now.getTime(), a = at(date, course.start), b = at(date, course.end);
    const status: CourseStatus = course.cancelled ? 'annule' : t >= b ? 'passe' : t >= a ? 'en-cours' : 'a-venir';
    const progress = status === 'passe' ? 1 : status === 'en-cours' ? (t - a) / (b - a) : 0;
    const changedKinds = [...new Set(changes.filter((c) => c.after && sameCourse(c.after, course)).map((c) => c.kind))];
    out.push({ kind: 'course', course, status, progress, changedKinds, ...(ghostSet.has(course) ? { ghost: true } : {}) });
  }
  return out;
}

const touches = (c: Change, date: string) => c.before?.date === date || c.after?.date === date;
const newest = (list: Change[]) => list.reduce<Change | null>((m, c) => (!m || time(c.detectedAt) > time(m.detectedAt) ? c : m), null);

export function dayModel(s: Snapshot, changes: Change[], date: string, now: Date):
  { items: DayItem[]; banner: Change | null; nextCourse: Course | null; changedDates: string[] } {
  const changedDates = [...new Set(changes.flatMap((c) => [c.before?.date, c.after?.date]).filter((d): d is string => !!d))].sort();
  const nextCourse = s.courses.filter((c) => !c.cancelled && at(c.date, c.start) > now.getTime())
    .sort((a, b) => a.date.localeCompare(b.date) || byStart(a, b))[0] ?? null;
  return { items: items(s, changes, date, now, true), banner: newest(changes.filter((c) => touches(c, date))), nextCourse, changedDates };
}

export function weekModel(s: Snapshot, changes: Change[], monday: string, now: Date):
  { days: { date: string; label: string; isToday: boolean; items: DayItem[] }[]; emptyDays: string[] } {
  const t = today(now);
  const days: { date: string; label: string; isToday: boolean; items: DayItem[] }[] = [], emptyDays: string[] = [];
  for (let i = 0; i < 6; i++) {
    const date = addDays(monday, i);
    const list = items(s, changes, date, now, false);
    if (list.length === 0) { emptyDays.push(date); continue; }
    const label = `${cap(weekday(date))} ${ymd(date).day}` + (date === t ? " · aujourd'hui" : '');
    days.push({ date, label, isToday: date === t, items: list });
  }
  return { days, emptyDays };
}

export function changesModel(changes: Change[], clearedAt: string | null, lastSeenAt: string | null): { visible: Change[]; unread: number } {
  const after = (iso: string | null) => (c: Change) => iso === null || time(c.detectedAt) > time(iso);
  const visible = changes.filter(after(clearedAt));
  return { visible, unread: visible.filter(after(lastSeenAt)).length };
}

/** « Nouveau » = detected after the lastSeenAt read when the view opened; « Plus tôt » = the rest. */
export function splitSeen(visible: Change[], seenBefore: string | null): { fresh: Change[]; earlier: Change[] } {
  const isNew = (c: Change) => seenBefore === null || time(c.detectedAt) > time(seenBefore);
  return { fresh: visible.filter(isNew), earlier: visible.filter((c) => !isNew(c)) };
}

// R23: read stamps use server time (detectedAt), never the device clock. A run's changes land in KV minutes after
// their detectedAt, so a device-clock stamp could hide a change that arrives later.
/** Newest detectedAt in the list, or null when empty. */
export const seenStamp = (changes: Change[]): string | null =>
  changes.reduce<string | null>((m, c) => (m === null || time(c.detectedAt) > time(m) ? c.detectedAt : m), null);
/** clearedAt for « Tout effacer » (the button only exists when `visible` is non-empty). */
export const clearStamp = (visible: Change[]) => seenStamp(visible)!;

/** A day/week picked on an earlier calendar day falls back to today's default (PWA resumed the next day). */
export const keepPick = <T>(p: { value: T; on: string } | null, now: Date): T | null => (p && p.on === today(now) ? p.value : null);

/** « il y a 12 min », « aujourd'hui, 08:10 », « hier, 18:40 », « jeu. 19 nov. » */
export function relTime(iso: string, now: Date): string {
  const d = new Date(iso), ago = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (ago < 1) return "à l'instant";
  if (ago < 60) return `il y a ${ago} min`;
  const p = brusselsParts(d), hm = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  const t = today(now);
  if (p.date === t) return `aujourd'hui, ${hm}`;
  if (p.date === addDays(t, -1)) return `hier, ${hm}`;
  const x = ymd(p.date);
  return `${DAYS[x.wd].slice(0, 3)}. ${x.day} ${MONTHS_SHORT[x.month]}`;
}

/** « Fin dans 1 h 20 » */
export function endsIn(c: Course, now: Date): string {
  const left = Math.max(0, Math.ceil((at(c.date, c.end) - now.getTime()) / 60_000));
  const h = Math.floor(left / 60), m = left % 60;
  return `Fin dans ${h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`}`;
}

/** Labels shown on a course in Jour and Semaine; never color alone. */
const TAGS: Partial<Record<ChangeKind, string>> = { horaire: 'Horaire', local: 'Local', deplace: 'Déplacé', enseignant: 'Enseignant' };
export function tags(item: Extract<DayItem, { kind: 'course' }>): string[] {
  if (item.status === 'annule') return ['Annulé'];
  return item.changedKinds.flatMap((k) => (TAGS[k] ? [TAGS[k]!] : []));
}

export const dayTitle = (date: string, now: Date) => {
  const t = today(now);
  return date === t ? "Aujourd'hui" : date === addDays(t, 1) ? 'Demain' : date === addDays(t, -1) ? 'Hier' : cap(weekday(date));
};

/** Monday–Saturday of the week containing `date` (Sunday belongs to the week it ends). */
export function dayBar(s: Snapshot, date: string, changedDates: string[]) {
  const monday = mondayOf(date);
  return Array.from({ length: 6 }, (_, i) => {
    const d = addDays(monday, i);
    return { date: d, short: `${DAYS[ymd(d).wd].slice(0, 3)}.`, num: ymd(d).day, name: `${cap(weekday(d))} ${ymd(d).day}`,
      hasCourses: s.courses.some((c) => c.date === d), changed: changedDates.includes(d) };
  });
}

/** False when the snapshot has no week containing or following today (holidays, year end): a calm state, not an error. */
export const hasWeekAhead = (s: Snapshot, now: Date) => s.weeks.some((w) => w >= mondayOf(today(now)));

/** Week containing today; on Sunday the next one when the snapshot has it. Always one of `s.weeks`. */
export function defaultWeek(s: Snapshot, now: Date): string {
  const t = today(now), monday = mondayOf(t);
  const want = ymd(t).wd === 0 && s.weeks.includes(addDays(monday, 7)) ? addDays(monday, 7) : monday;
  return s.weeks.includes(want) ? want : s.weeks.find((w) => w > want) ?? s.weeks[s.weeks.length - 1];
}

export function weekTitle(monday: string, now: Date): string {
  const n = Math.round((time(monday) - time(mondayOf(today(now)))) / (7 * 864e5));
  if (n === 0) return 'Cette semaine';
  if (n === 1) return 'Semaine prochaine';
  if (n === -1) return 'Semaine dernière';
  return n > 0 ? `Dans ${n} semaines` : `Il y a ${-n} semaines`;
}

/** « 23 – 28 novembre », « 30 nov. – 5 déc. » */
export function weekRange(monday: string): string {
  const a = ymd(monday), b = ymd(addDays(monday, 5));
  return a.month === b.month ? `${a.day} – ${b.day} ${MONTHS[a.month]}` : `${a.day} ${MONTHS_SHORT[a.month]} – ${b.day} ${MONTHS_SHORT[b.month]}`;
}

/** « Vendredi 27 et samedi 28 · pas de cours » */
export function emptyDaysText(dates: string[]): string {
  if (dates.length === 6) return 'Pas de cours cette semaine';
  const names = dates.map((d) => `${weekday(d)} ${ymd(d).day}`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
  return `${cap(list)} · pas de cours`;
}

/** Age of the data: lastSuccess (last good read), else fetchedAt, which only moves when the snapshot changes. */
export function freshness(s: Snapshot, lastSuccess: string | null, now: Date): { updated: string; stale: boolean } {
  const iso = lastSuccess ?? s.fetchedAt;
  const r = relTime(iso, now);
  return { updated: `Mis à jour ${/^(il|à|aujourd|hier)/.test(r) ? r : `le ${r}`}`, stale: isStale(new Date(iso), now) };
}

export type Tone = 'cancelled' | 'modified' | 'added';
export type Icon = 'cancel' | 'room' | 'clock' | 'plus' | 'move' | 'person' | 'edit';

const KIND: Record<ChangeKind, { label: string; tone: Tone; icon: Icon }> = {
  annule: { label: 'Cours annulé', tone: 'cancelled', icon: 'cancel' },
  local: { label: 'Local modifié', tone: 'modified', icon: 'room' },
  horaire: { label: 'Horaire modifié', tone: 'modified', icon: 'clock' },
  ajoute: { label: 'Cours ajouté', tone: 'added', icon: 'plus' },
  deplace: { label: 'Cours déplacé', tone: 'modified', icon: 'move' },
  enseignant: { label: 'Enseignant modifié', tone: 'modified', icon: 'person' },
  autre: { label: 'Cours modifié', tone: 'modified', icon: 'edit' },
};

/** Change card in Changements: label + title, then either a detail line or a before → after pair. */
export function changeCard(c: Change): { label: string; tone: Tone; icon: Icon; title: string; detail?: string; from?: string; to?: string } {
  const k = ref(c), b = c.before, a = c.after;
  const when = `${shortDate(k.date)}, ${k.start}`;
  const base = KIND[c.kind];
  switch (c.kind) {
    case 'annule':
      return { ...base, title: k.subject, detail: [cap(shortDate(k.date)), timeRange(k), k.room].filter(Boolean).join(' · ') };
    case 'local': return { ...base, title: `${k.subject} · ${when}`, from: b?.room || 'sans local', to: a?.room || 'sans local' };
    case 'horaire': return { ...base, title: `${k.subject} · ${shortDate(k.date)}`, from: b ? timeRange(b) : '', to: a ? timeRange(a) : '' };
    case 'deplace': return { ...base, title: k.subject,
      from: b ? `${shortDate(b.date)}, ${b.start}` : '', to: a ? `${shortDate(a.date)}, ${a.start}` : '' };
    case 'enseignant': return { ...base, title: `${k.subject} · ${when}`, from: b?.teacher || 'sans enseignant', to: a?.teacher || 'sans enseignant' };
    case 'ajoute': return { ...base, title: `${k.subject} · ${when}` };
    default: return { ...base, title: `${k.subject} · ${when}`, detail: a?.extra.length ? a.extra.join(' · ') : 'Détails mis à jour' };
  }
}

/** Day banner: « <strong>Act. gymniques 5 est annulé</strong> cet après-midi ». */
export function bannerText(c: Change, date: string, now: Date): { strong: string; rest: string; tone: Tone; icon: Icon } {
  const k = c.after?.date === date ? c.after : c.before ?? c.after!;
  const h = mins(k.start);
  const when = date !== today(now) ? `à ${k.start}` : h < 12 * 60 ? 'ce matin' : h < 18 * 60 ? 'cet après\u2011midi' /* non-breaking hyphen */ : 'ce soir';
  const { tone, icon } = KIND[c.kind];
  const s = k.subject;
  switch (c.kind) {
    case 'annule': return { tone, icon, strong: `${s} est annulé`, rest: when };
    case 'ajoute': return { tone, icon, strong: `${s} est ajouté`, rest: when };
    case 'local': return { tone, icon, strong: `${s} change de local`, rest: `: ${c.after?.room || 'sans local'}` };
    case 'horaire': return { tone, icon, strong: `${s} change d'horaire`, rest: c.after ? `: ${timeRange(c.after)}` : '' };
    case 'deplace': {
      const other = c.after?.date === date ? c.before : c.after;
      const there = other ? `${weekday(other.date)} ${ymd(other.date).day} à ${other.start}` : '';
      return { tone, icon, strong: `${s} est déplacé`, rest: c.after?.date === date ? `ici (avant : ${there})` : `au ${there}` };
    }
    case 'enseignant': return { tone, icon, strong: `${s} change d'enseignant`, rest: when };
    default: return { tone, icon, strong: `${s} est modifié`, rest: when };
  }
}
