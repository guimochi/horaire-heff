import { brusselsInstant, brusselsParts, DAYS, mins, MONTHS_SHORT, ref } from '../shared/time';
import type { Change } from '../shared/types';

const insteadOf = (v: string) => (v ? ` (au lieu de ${v})` : '');

function day(date: string, today: string): string {
  const n = Math.round((Date.parse(date) - Date.parse(today)) / 864e5);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  const dt = new Date(`${date}T00:00:00Z`);
  const wd = DAYS[dt.getUTCDay()];
  return n >= 7 ? `${wd} ${dt.getUTCDate()} ${MONTHS_SHORT[dt.getUTCMonth()]}` : wd;
}

export function notificationFor(changes: Change[], now: Date): { title: string; body: string; url: string } | null {
  const url = '/#/changements';
  const today = brusselsParts(now).date;
  const live = changes.filter((c) => brusselsInstant(ref(c).date, mins(ref(c).end)) > now);
  if (live.length === 0) return null;
  if (live.length >= 2) {
    const subjects = [...new Set(live.map((c) => ref(c).subject))];
    const body = subjects.slice(0, 3).join(', ') + (subjects.length > 3 ? '…' : '');
    return { title: `${live.length} changements dans ton horaire`, body, url };
  }
  const [c] = live;
  const { before: b, after: a } = c;
  const k = ref(c);
  const d = day(k.date, today);
  const head = `${k.subject} · ${d} ${k.start}`;
  switch (c.kind) {
    case 'annule': return { title: 'Cours annulé', body: `${head} n'aura pas lieu.`, url };
    case 'local': return { title: 'Changement de local', body: `${head} → ${a!.room ? `local ${a!.room}` : 'local non précisé'}${insteadOf(b!.room)}.`, url };
    case 'horaire': return { title: 'Horaire modifié',
      body: `${k.subject} · ${d} : ${a!.start}–${a!.end} (au lieu de ${b!.start}–${b!.end}).`, url };
    case 'ajoute': return { title: 'Cours ajouté',
      body: `${k.subject} · ${d} ${k.start}–${k.end}${k.room ? ` · ${k.room}` : ''}.`, url };
    case 'deplace': return { title: 'Cours déplacé',
      body: `${k.subject} · ${day(b!.date, today)} ${b!.start} → ${d} ${a!.start}.`, url };
    case 'enseignant': return { title: 'Enseignant modifié',
      body: `${head} · ${a!.teacher ? `avec ${a!.teacher}` : 'sans enseignant'}${insteadOf(b!.teacher)}.`, url };
    default: return { title: 'Cours modifié', body: `${head} · détails mis à jour.`, url };
  }
}

/** Push TTL: seconds until the last notified course ends (a stale push is noise), within [60 s, 12 h]. */
export function pushTtl(changes: Change[], now: Date): number {
  const last = Math.max(...changes.map((c) => brusselsInstant(ref(c).date, mins(ref(c).end)).getTime()));
  return Math.min(43200, Math.max(60, Math.ceil((last - now.getTime()) / 1000)));
}
