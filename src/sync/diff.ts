import type { Change, ChangeKind, Course, Snapshot } from '../shared/types';
import { mondayOf, ref } from '../shared/time';

export const courseKey = (c: Course): string => `${c.date}|${c.subject}|${c.group}`;
const sgKey = (c: Course) => `${c.subject}|${c.group}`;
const sortKey = (c: Course) => `${c.date} ${c.start}`;
const byStart = (a: Course, b: Course) => a.start.localeCompare(b.start);

export function diffSnapshots(prev: Snapshot, next: Snapshot, detectedAt: string): Change[] {
  const weeks = new Set(prev.weeks.filter((w) => next.weeks.includes(w)));
  const group = (s: Snapshot) => {
    const m = new Map<string, Course[]>();
    for (const c of s.courses) {
      if (!weeks.has(mondayOf(c.date))) continue;
      const k = courseKey(c);
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    for (const l of m.values()) l.sort(byStart);
    return m;
  };
  const P = group(prev), N = group(next);

  const out: Change[] = [];
  const mk = (kind: ChangeKind, before: Course | null, after: Course | null) =>
    out.push({ id: `${kind}|${courseKey((after ?? before)!)}|${(after ?? before)!.start}|${detectedAt}`, kind, promo: next.promo, detectedAt, before, after });
  const gone: Course[] = [], added: Course[] = [];

  for (const k of new Set([...P.keys(), ...N.keys()])) {
    const a = P.get(k) ?? [], b = N.get(k) ?? [];
    // Pair identical starts first, then leftovers chronologically.
    const pairs: [Course | undefined, Course | undefined][] = [];
    const ra = [...a], rb: Course[] = [];
    for (const y of b) {
      const i = ra.findIndex((x) => x.start === y.start);
      if (i >= 0) pairs.push([ra.splice(i, 1)[0], y]); else rb.push(y);
    }
    for (let i = 0; i < Math.max(ra.length, rb.length); i++) pairs.push([ra[i], rb[i]]);
    for (const [x, y] of pairs) {
      if (x && !y) { if (!x.cancelled) gone.push(x); continue; }
      if (!x && y) { if (!y.cancelled) added.push(y); continue; }
      if (!x || !y) continue;
      if (y.cancelled) { if (!x.cancelled) mk('annule', x, y); continue; }
      if (x.start !== y.start || x.end !== y.end) mk('horaire', x, y);
      if (x.room !== y.room) mk('local', x, y);
      if (x.teacher !== y.teacher) mk('enseignant', x, y);
      if (x.extra.length !== y.extra.length || x.extra.some((e, j) => e !== y.extra[j])) mk('autre', x, y);
      if (x.cancelled && !y.cancelled) mk('ajoute', x, y);
    }
  }

  // Same date, start, end and subject under another group = one edit (regroup), not « annulé + ajouté ».
  // (`gone` and `added` never hold a cancelled course: see the pairing above.)
  const slot = (c: Course) => `${c.date}|${c.start}|${c.end}|${c.subject}`;
  const used = new Set<Course>(), regrouped = new Set<Course>();
  for (const g of gone) {
    const m = added.find((a) => !used.has(a) && slot(a) === slot(g));
    if (m) { used.add(m); regrouped.add(g); mk('autre', g, m); }
  }
  // Disappearance + appearance of same subject|group in same week = moved course.
  for (const g of gone) {
    if (regrouped.has(g)) continue;
    const m = added.find((a) => !used.has(a) && sgKey(a) === sgKey(g) && mondayOf(a.date) === mondayOf(g.date));
    if (m) { used.add(m); mk('deplace', g, m); } else mk('annule', g, null);
  }
  for (const a of added) if (!used.has(a)) mk('ajoute', null, a);

  return out.sort((p, q) => sortKey(ref(p)).localeCompare(sortKey(ref(q))) || p.kind.localeCompare(q.kind));
}
