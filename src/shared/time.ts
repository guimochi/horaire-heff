import type { Change, Course } from './types';

// Everything in Europe/Brussels; no fixed offset assumed (DST-safe).
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Brussels', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

export function brusselsParts(d: Date): { date: string; weekday: number; hour: number; minute: number } {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return { date, weekday: dow === 0 ? 7 : dow, hour: Number(p.hour), minute: Number(p.minute) };
}

const SLOT_FIRST = 6 * 60, SLOT_LAST = 22 * 60, SLOT_STEP = 30;

export function isInRunWindow(d: Date): boolean {
  const { weekday, hour, minute } = brusselsParts(d);
  const t = hour * 60 + minute;
  return weekday <= 6 && t >= SLOT_FIRST && t < 22 * 60 + 30;
}

// UTC instant of a Brussels wall-clock time (iterate offset to settle across DST).
export function brusselsInstant(date: string, minutes: number): Date {
  const [y, m, day] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, day, 0, minutes);
  let t = wall;
  for (let i = 0; i < 2; i++) {
    const p = brusselsParts(new Date(t));
    const shown = Date.UTC(+p.date.slice(0, 4), +p.date.slice(5, 7) - 1, +p.date.slice(8, 10), p.hour, p.minute);
    t += wall - shown;
  }
  return new Date(t);
}

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export function nextSlotAfter(d: Date): Date {
  const start = brusselsParts(d).date;
  for (let i = 0; i <= 8; i++) {
    const date = addDays(start, i);
    if (brusselsParts(brusselsInstant(date, 12 * 60)).weekday === 7) continue;
    for (let m = SLOT_FIRST; m <= SLOT_LAST; m += SLOT_STEP) {
      const t = brusselsInstant(date, m);
      if (t > d) return t;
    }
  }
  throw new Error('unreachable');
}

export function isStale(fetchedAt: Date, now: Date): boolean {
  return now.getTime() - nextSlotAfter(fetchedAt).getTime() > 60 * 60_000;
}

export function mondayOf(dateIso: string): string {
  const dow = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  return addDays(dateIso, -((dow + 6) % 7));
}

export const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
/** « HH:MM » to minutes since midnight. */
export const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** The course a change is about: the new one, or the old one when it vanished. */
export const ref = (c: Change): Course => (c.after ?? c.before)!;
