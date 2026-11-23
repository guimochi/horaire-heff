import type { Course, Snapshot } from '../shared/types';
import { mondayOf } from '../shared/time';

// Courses restricted to the weeks read in both snapshots, counted per week.
function commonCounts(prev: Snapshot, next: Snapshot) {
  const common = prev.weeks.filter(w => next.weeks.includes(w));
  const count = (s: Snapshot) => {
    const m = new Map<string, number>(common.map(w => [w, 0]));
    for (const c of s.courses) { const w = mondayOf(c.date); if (m.has(w)) m.set(w, m.get(w)! + 1); }
    return m;
  };
  return { common, p: count(prev), n: count(next) };
}
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

export function isTotalWipe(prev: Snapshot | null, next: Snapshot): boolean {
  if (!prev) return false;
  const { p, n } = commonCounts(prev, next);
  return sum(p) >= 4 && sum(n) === 0;
}

// Per-week R7: a week that held >= 3 courses reading 0 means the grid broke, not a real strike.
export function wipedWeeks(prev: Snapshot | null, next: Snapshot): string[] {
  if (!prev) return [];
  const { common, p, n } = commonCounts(prev, next);
  return common.filter(w => p.get(w)! >= 3 && n.get(w) === 0);
}
export const isWeekWipe = (prev: Snapshot | null, next: Snapshot) => wipedWeeks(prev, next).length > 0;

export function isSuspicious(prev: Snapshot | null, next: Snapshot): boolean {
  if (!prev) return false;
  const { common, p, n } = commonCounts(prev, next);
  if (common.some(w => p.get(w)! >= 1 && n.get(w) === 0)) return true;
  return sum(p) >= 4 && sum(n) < sum(p) / 2;
}

const key = (c: Course) => JSON.stringify([c.date, c.start, c.end, c.subject, c.teacher, c.room, c.group, c.cancelled, c.extra]);
export const canon = (s: Snapshot) => JSON.stringify([s.weeks, s.courses.map(key).sort()]);

export function decidePublish(prev: Snapshot | null, pending: Snapshot | null, next: Snapshot):
  { publish: boolean; pending: Snapshot | null } {
  if (!isSuspicious(prev, next)) return { publish: true, pending: null };
  // A real strike keeps cancelled courses on the page; everything vanishing means the page broke.
  if (!isTotalWipe(prev, next) && !isWeekWipe(prev, next) && pending && canon(pending) === canon(next)) return { publish: true, pending: null };
  return { publish: false, pending: next };
}
