import { useState } from 'preact/hooks';
import type { Change } from '../../shared/types';
import type { Schedule } from '../data';
import { bannerText, cap, dayBar, dayModel, dayTitle, hasWeekAhead, keepPick, longDate, shortDate, today } from '../model';
import { promoLabel } from '../store';
import { CourseCard } from '../components/CourseCard';
import { DatePick } from '../components/DatePick';
import { Icon } from '../components/Icon';
import { Calm, StaleBanner, Updated } from '../components/Status';

export function Day({ promo, schedule, changes, now, retry }: {
  promo: string; schedule: Schedule; changes: Change[] | null; now: Date; retry: () => void;
}) {
  // A pick made on an earlier calendar day is dropped: resumed the next day, the view shows today.
  const [picked, setPicked] = useState<{ value: string; on: string } | null>(null);
  const date = keepPick(picked, now) ?? today(now);
  const s = schedule.state === 'ready' ? schedule.snapshot : null;
  const noWeeks = !!s && !hasWeekAhead(s, now);
  const m = s && !noWeeks ? dayModel(s, changes ?? [], date, now) : null;
  const banner = m?.banner ? bannerText(m.banner, date, now) : null;

  return (
    <div class="view">
      <header class="view-head">
        <div class="head-row">
          <span class="promo-pill">{promoLabel(promo)}</span>
          <div class="head-actions">
            {s && m && <DatePick weeks={s.weeks} value={date} onPick={(d) => setPicked({ value: d, on: today(now) })} />}
            <a class="icon-btn" href="#/reglages" aria-label="Réglages"><Icon name="settings" size={22} width={1.8} /></a>
          </div>
        </div>
        <div class="head-title">
          <h1 class="h-big">{dayTitle(date, now)}</h1>
          <p class="sub">{longDate(date)}</p>
        </div>
      </header>

      {s && m && (
        <nav class="daybar" aria-label="Jours de la semaine">
          {dayBar(s, date, m.changedDates).map((d) => (
            <button key={d.date} type="button" aria-pressed={d.date === date} onClick={() => setPicked({ value: d.date, on: today(now) })}
              aria-label={d.changed ? `${d.name}, contient un changement` : d.name}
              class={d.date === date ? 'is-selected' : d.hasCourses ? '' : 'is-empty'}>
              <span class="daybar-wd">{d.short}</span><span class="daybar-num">{d.num}</span>
              {d.changed && d.date !== date && <span class="daybar-dot" aria-hidden="true" />}
            </button>
          ))}
        </nav>
      )}

      <main class="view-main">
        {schedule.state === 'loading' && <Calm kind="loading" />}
        {schedule.state === 'pending' && <Calm kind="pending" />}
        {(schedule.state === 'offline' || schedule.state === 'error') && <Calm kind={schedule.state} retry={retry} />}
        {schedule.state === 'ready' && noWeeks && (
          <>
            <StaleBanner s={schedule.snapshot} lastSuccess={schedule.lastSuccess} now={now} />
            <Calm kind="noweeks" />
            <Updated s={schedule.snapshot} lastSuccess={schedule.lastSuccess} now={now} />
          </>
        )}
        {schedule.state === 'ready' && m && (
          <>
            <StaleBanner s={schedule.snapshot} lastSuccess={schedule.lastSuccess} now={now} />
            {banner && (
              <a class={`banner tone-${banner.tone}`} href="#/changements">
                <Icon name={banner.icon} size={22} />
                <span class="banner-text"><strong>{banner.strong}</strong> {banner.rest}</span>
                <Icon name="next" size={18} width={2} />
              </a>
            )}
            {m.items.map((it) => it.kind === 'pause'
              ? <div key={`p${it.from}`} class="pause"><span /><span>Pause · {it.from} – {it.to}</span><span /></div>
              : <CourseCard key={`${it.course.start}|${it.course.subject}|${it.course.group}${it.ghost ? '|ghost' : ''}`} item={it} now={now} />)}
            {m.items.length === 0 && (
              <div class="empty-day">
                <h2>Pas de cours</h2>
                <p>{m.nextCourse ? 'Ton prochain cours :' : 'Rien de prévu dans les semaines à venir.'}</p>
                {m.nextCourse && <CourseCard now={now} when={cap(shortDate(m.nextCourse.date))}
                  item={{ kind: 'course', course: m.nextCourse, status: 'a-venir', progress: 0, changedKinds: [] }} />}
              </div>
            )}
            <Updated s={schedule.snapshot} lastSuccess={schedule.lastSuccess} now={now} />
          </>
        )}
      </main>
    </div>
  );
}
