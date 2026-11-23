import { useState } from 'preact/hooks';
import type { Change } from '../../shared/types';
import type { Schedule } from '../data';
import { defaultWeek, emptyDaysText, hasWeekAhead, keepPick, tags, today, weekModel, weekRange, weekTitle } from '../model';
import { promoLabel } from '../store';
import { Icon } from '../components/Icon';
import { Calm, StaleBanner, Updated } from '../components/Status';

export function Week({ promo, schedule, changes, now, retry }: {
  promo: string; schedule: Schedule; changes: Change[] | null; now: Date; retry: () => void;
}) {
  // A week picked on an earlier calendar day is dropped: resumed the next day, the view shows the current week.
  const [picked, setPicked] = useState<{ value: string; on: string } | null>(null);
  const kept = keepPick(picked, now);
  const s = schedule.state === 'ready' && hasWeekAhead(schedule.snapshot, now) ? schedule.snapshot : null;
  // Arrows stay inside the snapshot window (current week + 3).
  const monday = s ? (kept && s.weeks.includes(kept) ? kept : defaultWeek(s, now)) : null;
  const i = s && monday ? s.weeks.indexOf(monday) : -1;
  const prev = s && i > 0 ? s.weeks[i - 1] : null;
  const next = s && i >= 0 && i < s.weeks.length - 1 ? s.weeks[i + 1] : null;
  const m = s && monday ? weekModel(s, changes ?? [], monday, now) : null;

  return (
    <div class="view">
      <header class="view-head week-head">
        <span class="promo-pill">{promoLabel(promo)}</span>
        {monday && (
          <div class="week-nav">
            <button type="button" class="icon-btn" aria-label="Semaine précédente" disabled={!prev} onClick={() => prev && setPicked({ value: prev, on: today(now) })}>
              <Icon name="prev" size={20} width={2} />
            </button>
            <div class="week-title">
              <h1>{weekTitle(monday, now)}</h1>
              <p>{weekRange(monday)}</p>
            </div>
            <button type="button" class="icon-btn" aria-label="Semaine suivante" disabled={!next} onClick={() => next && setPicked({ value: next, on: today(now) })}>
              <Icon name="next" size={20} width={2} />
            </button>
          </div>
        )}
        {!monday && <h1 class="h-big">Semaine</h1>}
      </header>

      <main class="view-main week-main">
        {schedule.state === 'loading' && <Calm kind="loading" />}
        {schedule.state === 'pending' && <Calm kind="pending" />}
        {(schedule.state === 'offline' || schedule.state === 'error') && <Calm kind={schedule.state} retry={retry} />}
        {schedule.state === 'ready' && !s && (
          <>
            <StaleBanner s={schedule.snapshot} lastSuccess={schedule.lastSuccess} now={now} />
            <Calm kind="noweeks" />
            <Updated s={schedule.snapshot} lastSuccess={schedule.lastSuccess} now={now} />
          </>
        )}
        {schedule.state === 'ready' && m && (
          <>
            <StaleBanner s={schedule.snapshot} lastSuccess={schedule.lastSuccess} now={now} />
            {m.days.map((d) => (
              <section key={d.date} class="week-day">
                <h2 class={d.isToday ? 'is-today' : ''}>{d.label}</h2>
                <div class="week-rows">
                  {d.items.map((it) => {
                    if (it.kind !== 'course') return null;
                    const c = it.course, t = tags(it), off = it.status === 'annule';
                    return (
                      <div key={`${c.start}|${c.subject}|${c.group}${it.ghost ? '|ghost' : ''}`} class={`week-row${off ? ' is-annule' : ''}`}>
                        <span class={`week-time${t.includes('Horaire') ? ' is-modified' : ''}`}>{c.start}</span>
                        <div class="week-body">
                          <span class="week-subject">{c.subject}</span>
                          <span class="week-sub">
                            {off ? c.room : <>jusqu'à {c.end}{c.room && ' · '}{c.room && (t.includes('Local') ? <strong>{c.room}</strong> : c.room)}</>}
                          </span>
                        </div>
                        {t.map((x) => <span key={x} class={`pill pill-sm ${x === 'Annulé' ? 'pill-cancelled' : 'pill-modified'}`}>{x}</span>)}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            {m.emptyDays.length > 0 && <p class="empty-days">{emptyDaysText(m.emptyDays)}</p>}
            <Updated s={schedule.snapshot} lastSuccess={schedule.lastSuccess} now={now} />
          </>
        )}
      </main>
    </div>
  );
}
