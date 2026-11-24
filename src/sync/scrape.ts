import type { Page } from 'playwright';
import type { Course } from '../shared/types';
import { HP_URL } from '../shared/hp';
import { addDays, mondayOf, MONTHS } from '../shared/time';
import { parseCourse, type RawCourse } from './parse';

// Public guest space only (HP_URL). Grid view ("Emploi du temps > en grille", the default on load).
const TIMEOUT = 30_000;
const SETTLE_MS = 300;
const EMPTY_RECHECK_MS = 3000;

export type GridCounts = { courses: number; cells: number; contents: number; labelled: number };

// Selector drift guard: every course-like element in the grid must be a course we read (0 everywhere = real empty week).
export function checkGridCounts(c: GridCounts, weekStart: string): void {
  if (c.cells !== c.courses || c.contents !== c.courses || c.labelled !== c.courses)
    throw new Error(`Hyperplanning: grille illisible, semaine ${weekStart}: ${JSON.stringify(c)}`);
}

/** Waits for two identical reads SETTLE_MS apart. An empty result is read once more after EMPTY_RECHECK_MS:
 * a grid not drawn yet reads empty, and a false empty week reads as mass cancellation. */
export async function settle<T>(read: () => Promise<T>, wait: (ms: number) => Promise<void>, isEmpty: (v: T) => boolean, what: string): Promise<T> {
  let prev = await read(), cur = prev;
  for (const deadline = Date.now() + TIMEOUT; ; prev = cur) {
    await wait(SETTLE_MS);
    cur = await read();
    if (JSON.stringify(cur) === JSON.stringify(prev)) {
      if (!isEmpty(cur)) return cur;
      await wait(EMPTY_RECHECK_MS);
      cur = await read();
      if (isEmpty(cur)) return cur;
    }
    if (Date.now() > deadline) throw new Error(`Hyperplanning: ${what}`);
  }
}

export type WeekOption = { label: string; disabled: boolean };

/** Index of each requested week in the week list; -1 when absent (end of year), read like a disabled week. */
export function weekIndexes(options: WeekOption[], weeks: string[]): number[] {
  if (options.length === 0) throw new Error('Hyperplanning: liste des semaines vide');
  // A label format change would read every week as absent, i.e. an empty, calm timetable.
  if (!options.some((o) => /du \d{2}\/\d{2}\/\d{4}/.test(o.label))) throw new Error('Hyperplanning: libellés des semaines non reconnus');
  return weeks.map((w) => {
    const [y, m, d] = w.split('-');
    return options.findIndex((o) => o.label.includes(`du ${d}/${m}/${y}`));
  });
}

// `teachers`: the list view's Enseignant names for the week; absent when that view could not be read.
export type RawWeek = { weekLabel: string; weekStart: string; disabled: boolean; groups: string[]; courses: RawCourse[]; teachers?: string[] };

const promoBox = (page: Page) => page.getByRole('combobox', { name: 'Sélectionnez une [classe]' });
const promoOptions = (page: Page) => page.getByRole('navigation', { name: 'Menu de troisième niveau' }).getByRole('option');
const withPopupHandler = new WeakSet<Page>();

// Fresh load every time: resets the page to a known state (grid view, current week).
// The cookie popup shows only on the first load of a browser context, so it is dismissed whenever it appears.
async function openGuest(page: Page): Promise<void> {
  page.setDefaultTimeout(TIMEOUT);
  if (!withPopupHandler.has(page)) {
    withPopupHandler.add(page);
    const popup = page.getByRole('alertdialog', { name: 'Information' });
    await page.addLocatorHandler(popup, () => popup.getByRole('button', { name: 'Fermer' }).last().click());
  }
  await page.goto(HP_URL, { waitUntil: 'load', timeout: TIMEOUT });
  await promoBox(page).waitFor();
}

// Typing "*" + Enter lists every promotion.
async function openPromoList(page: Page): Promise<string[]> {
  const cb = promoBox(page);
  await cb.click();
  await cb.fill('*');
  await cb.press('Enter');
  await promoOptions(page).first().waitFor();
  // The list can still be filling in: a short list would be written as the new promo list.
  await settle(() => promoOptions(page).count(), (ms) => page.waitForTimeout(ms), () => false, 'liste des promotions instable');
  const names = (await promoOptions(page).allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (names.length === 0) throw new Error('Hyperplanning: liste des promotions vide');
  return names;
}

export async function scrapePromoList(page: Page): Promise<string[]> {
  await openGuest(page);
  const names = await openPromoList(page);
  await promoBox(page).press('Escape');
  return names;
}

export async function scrapePromoRaw(page: Page, promo: string, weeks: string[]): Promise<RawWeek[]> {
  await openGuest(page);
  const names = await openPromoList(page);
  if (!names.includes(promo)) throw new Error('Hyperplanning: promotion absente de la liste'); // no name: the sync logs are public
  await page.getByRole('navigation', { name: 'Menu de troisième niveau' }).getByRole('option', { name: promo, exact: true }).click();

  // The toggle label is the action: "Masquer…" means cancelled courses are shown.
  const show = page.getByRole('button', { name: 'Afficher les cours annulés' });
  const hide = page.getByRole('button', { name: 'Masquer les cours annulés' });
  await show.or(hide).first().waitFor();
  if (await show.isVisible()) await show.click();
  await hide.waitFor();

  const main = page.getByRole('main');
  const weekList = main.getByRole('listbox', { name: /^Multi-s/ });
  await weekList.waitFor();
  const options = await weekList.getByRole('option').evaluateAll((els) => els.map((e) => ({
    label: document.getElementById(e.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() ?? '', disabled: e.getAttribute('aria-disabled') === 'true' })));

  const out: RawWeek[] = [];
  const indexes = weekIndexes(options, weeks);
  for (const [k, weekStart] of weeks.entries()) {
    const [, m, d] = weekStart.split('-');
    const idx = indexes[k];
    // Absent = past the end of the school year: omitted like a disabled week, not an error every run.
    if (idx < 0) { out.push({ weekLabel: '', weekStart, disabled: true, groups: [], courses: [] }); continue; }
    const { label, disabled } = options[idx];
    // Disabled = week not published (holidays, not yet open): nothing to read.
    if (disabled) { out.push({ weekLabel: label, weekStart, disabled, groups: [], courses: [] }); continue; }

    const opt = weekList.getByRole('option').nth(idx);
    if ((await opt.getAttribute('aria-selected')) !== 'true') await opt.click();
    // Rendered = Monday header shows the requested date and the course container exists (it may be empty).
    const monday = new RegExp(`^lun\\. 0?${+d}(?:er)? ${MONTHS[+m - 1]}$`);
    await main.locator('[id$="_titreTranche0"]').filter({ hasText: monday }).waitFor();
    await main.locator('.ObjetGrilleCours').first().waitFor({ state: 'attached' });

    const grid = main.locator('.ObjetGrilleCours').first();
    const read = () => grid.evaluate((grid) => {
      const groups = new Set<string>();
      const courses = [...grid.querySelectorAll('[role="group"][aria-label^="Cours du"]')].map((el) => ({
        aria: el.getAttribute('aria-label') ?? '',
        lines: [...el.querySelectorAll('.content_cours > [role="listitem"]')].map((li) => {
          const text = (li.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (li.querySelector('.contenuMemo')) return `Mémo ${text}`;
          if (li.querySelector('[role="link"][aria-label^="Accéder à l\'emploi du temps de"]')) groups.add(text);
          return text;
        }),
        cancelledMarker: el.querySelector('.bandeauAnnule') !== null,
      }));
      const counts: GridCounts = {
        courses: courses.length,
        cells: grid.querySelectorAll('.EmploiDuTemps_Element').length,
        contents: grid.querySelectorAll('.content_cours').length,
        labelled: grid.querySelectorAll('[aria-label*="Cours"]').length,
      };
      return { courses, groups: [...groups], counts };
    });
    // Settle: the container can exist before the courses are drawn, so wait for two identical reads 300 ms apart.
    const cur = await settle(read, (ms) => page.waitForTimeout(ms), (r) => r.courses.length === 0, `grille instable, semaine ${weekStart}`);
    checkGridCounts(cur.counts, weekStart);
    const { courses, groups } = cur;
    out.push({ weekLabel: label, weekStart, disabled, groups, courses });
  }
  await readTeachers(page, indexes, out);
  return out;
}

/** "23 novembre 2026" for each day of the week: the list view's day headers ("lundi 23 novembre 2026", "1er"). */
export const dayLabels = (weekStart: string) => [0, 1, 2, 3, 4, 5, 6].map((n) => {
  const [y, m, d] = addDays(weekStart, n).split('-');
  return `${+d} ${MONTHS[+m - 1]} ${y}`;
});

// Read in the page: no closure. Day header rows start with the weekday, course rows with "08h00 - 10h00".
const readList = (main: Element) => {
  const heads = [...main.querySelectorAll('[role="columnheader"]')].map((h) => (h.textContent ?? '').trim());
  const col = heads.indexOf('Enseignant');
  const days: string[] = [];
  const teachers = new Set<string>();
  let rows = 0;
  for (const r of main.querySelectorAll('[role="row"]')) {
    const cells = (r.getAttribute('aria-owns') ?? '').trim().split(/\s+/).map((id) => document.getElementById(id));
    const first = (cells[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (/^\d{2}h\d{2} - \d{2}h\d{2}/.test(first)) {
      rows++;
      for (const t of ((cells[col] as HTMLElement | null)?.innerText ?? '').split('\n')) if (t.trim()) teachers.add(t.replace(/\s+/g, ' ').trim());
    } else if (/^\S+ \d+(?:er)? \S+ \d{4}$/.test(first)) days.push(first.replace(/ (\d+)er /, ' $1 '));
  }
  return { col, rows, days, teachers: [...teachers] };
};

/** The grid can't tell teachers from rooms on a course without a group line; the list view has an Enseignant column.
 * A week whose list can't be matched to its grid (other week shown, other course count) keeps `teachers` unset. */
async function readTeachers(page: Page, indexes: number[], out: RawWeek[]): Promise<void> {
  if (!out.some((w) => w.courses.length)) return;
  try {
    await page.locator('li[data-genre="DIPLOME.EDT.EDT_LISTE"]').dispatchEvent('click');
    await page.getByRole('heading', { name: 'en liste' }).waitFor();
    const main = page.getByRole('main');
    const weekList = main.getByRole('listbox', { name: /^Multi-s/ });
    for (const [k, w] of out.entries()) {
      if (w.disabled || w.courses.length === 0) continue;
      const opt = weekList.getByRole('option').nth(indexes[k]);
      if ((await opt.getAttribute('aria-selected')) !== 'true') await opt.click();
      const days = dayLabels(w.weekStart);
      // Two identical matching reads: a list caught mid-render would turn teachers into rooms (false "local" alerts).
      let prev = '';
      for (const deadline = Date.now() + TIMEOUT; Date.now() < deadline; await page.waitForTimeout(SETTLE_MS)) {
        const r = await main.evaluate(readList);
        const cur = JSON.stringify(r);
        // Hyperplanning hides an empty column: a matching list without Enseignant is a week without teachers.
        if (cur === prev && r.rows === w.courses.length && r.days.every((d) => days.some((x) => d.endsWith(x)))) { w.teachers = r.teachers; break; }
        prev = cur;
      }
      if (!w.teachers) console.warn(`sync: liste illisible, semaine ${w.weekStart}`); // grid order is used instead
    }
  } catch (e) {
    console.warn(`sync: liste illisible: ${(e as Error).message.split('\n')[0]}`);
  }
}

// Disabled weeks are omitted from `weeks`: "not published" must never read as "no courses".
export function readWeeks(raw: RawWeek[]): { courses: Course[]; weeks: string[] } {
  const read = raw.filter((w) => !w.disabled);
  const courses = read.flatMap((w) => w.courses.map((r) => {
    const c = parseCourse(r, w.weekStart, w.groups, w.teachers);
    if (mondayOf(c.date) !== w.weekStart) throw new Error(`Hyperplanning: cours hors semaine ${w.weekStart}: ${r.aria}`);
    return c;
  }));
  return { courses, weeks: read.map((w) => w.weekStart) };
}

export async function scrapePromo(page: Page, promo: string, weeks: string[]): Promise<{ courses: Course[]; weeks: string[] }> {
  return readWeeks(await scrapePromoRaw(page, promo, weeks));
}
