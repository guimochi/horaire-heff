import { MONTHS } from '../shared/time';
import type { Course } from '../shared/types';

export type RawCourse = { aria: string; lines: string[]; cancelledMarker: boolean };

const ARIA = /^Cours du (\d+)(?:er)? (\S+) de (\d+) heures (\d+) à (\d+) heures (\d+)$/;
const pad = (n: number) => String(n).padStart(2, '0');

// `groups`: group names seen as links in the grid (scrape.ts). Without it, a line containing " - " is a group.
// `teachers`: names from the list view's Enseignant column (scrape.ts), for courses without a group line.
export function parseCourse(raw: RawCourse, weekStart: string, groups?: string[], teachers?: string[]): Course {
  const m = raw.aria.match(ARIA);
  const month = m ? MONTHS.indexOf(m[2]) + 1 : 0;
  if (!m || !month) throw new Error(`Hyperplanning: aria non reconnu: "${raw.aria}"`);
  const [wy, wm] = weekStart.split('-').map(Number);
  const date = `${month < wm ? wy + 1 : wy}-${pad(month)}-${pad(+m[1])}`;

  const [subject = '', ...rest] = raw.lines;
  const isMemo = (l: string) => l.startsWith('Mémo '); // prefix added by scrape.ts for .contenuMemo items
  const isGroup = (l: string) => (groups ? groups.includes(l) : l.includes(' - '));
  const body = rest.filter((l) => !isMemo(l));
  const g0 = body.findIndex(isGroup);
  let teacher: string, group: string, after: string[];
  if (g0 >= 0) {
    let g1 = g0;
    while (g1 < body.length && isGroup(body[g1])) g1++;
    teacher = body.slice(0, g0).join(', ');
    group = body.slice(g0, g1).join(', ');
    after = body.slice(g1);
  } else {
    // No group anchor: the grid can't tell a second teacher from a room ("Gymnase Buls"). Teachers come first, so the known
    // teacher names lead and the rest are rooms. Callers without a list (old fixtures): positional, [teacher, ...rooms].
    const n = teachers ? body.findIndex((l) => !teachers.includes(l)) : Math.min(1, body.length);
    const k = n < 0 ? body.length : n;
    teacher = body.slice(0, k).join(', ');
    after = body.slice(k);
    group = '';
  }
  return {
    date, start: `${pad(+m[3])}:${m[4]}`, end: `${pad(+m[5])}:${m[6]}`,
    // Lines after the group(s) are rooms (a course can use several).
    subject, teacher, room: after.join(', '), group, cancelled: raw.cancelledMarker, extra: rest.filter(isMemo),
  };
}
