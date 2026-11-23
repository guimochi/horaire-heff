import type { DayItem } from '../model';
import { endsIn, tags, timeRange } from '../model';
import { Icon } from './Icon';

type Item = Extract<DayItem, { kind: 'course' }>;

const STATUS_PILL: Record<string, { text: string; cls: string } | undefined> = {
  'en-cours': { text: 'En cours', cls: 'pill-now' },
  annule: { text: 'Annulé', cls: 'pill-cancelled' },
  passe: { text: 'Terminé', cls: 'pill-past' },
};

/** Day-view card. `when` prefixes the time (« Lundi 30 nov. · ») for the next-course card of an empty day. */
export function CourseCard({ item, now, when }: { item: Item; now: Date; when?: string }) {
  const { course: c, status } = item;
  const pills = [STATUS_PILL[status], ...tags(item).filter((t) => t !== 'Annulé').map((t) => ({ text: t, cls: 'pill-modified' }))]
    .filter((p): p is { text: string; cls: string } => !!p);
  const roomChanged = item.changedKinds.includes('local') && status !== 'annule';
  return (
    <article class={`course is-${status}`}>
      <div class="course-top">
        {pills.length > 0 && <span class="pills">{pills.map((p) => <span key={p.text} class={`pill ${p.cls}`}>{p.text}</span>)}</span>}
        <span class="course-time">{when ? `${when} · ` : ''}{timeRange(c)}</span>
      </div>
      <h2 class="course-title">{c.subject}</h2>
      {(c.room || c.teacher) && (
        <div class="course-meta">
          {c.room && <span><Icon name="room" size={17} width={1.8} /><span class={roomChanged ? 'room room-changed' : 'room'}>{c.room}</span></span>}
          {c.teacher && <span><Icon name="person" size={17} width={1.8} />{c.teacher}</span>}
        </div>
      )}
      {c.extra.length > 0 && <p class="course-extra">{c.extra.join(' · ')}</p>}
      {status === 'en-cours' && (
        <div class="progress">
          <div role="progressbar" aria-label="Progression du cours" aria-valuenow={Math.round(item.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${item.progress * 100}%` }} />
          </div>
          <span>{endsIn(c, now)}</span>
        </div>
      )}
    </article>
  );
}
