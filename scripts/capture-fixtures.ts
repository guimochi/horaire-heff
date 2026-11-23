// Captures real Hyperplanning grid data into tests/fixtures/ (public timetable data).
// Run: npx tsx scripts/capture-fixtures.ts
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { scrapePromo, scrapePromoList, scrapePromoRaw } from '../src/sync/scrape';

const PROMO = 'BA3 - S3 - EPS';
const WEEKS = ['2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14'];
const CANCELLED_WEEK = '2026-10-05'; // 6 Oct 09:00 "Sports et jeux" is cancelled (seen in "Cours annulés")

const dir = new URL('../tests/fixtures/', import.meta.url);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ locale: 'fr-BE' });
  const promos = await scrapePromoList(page);
  console.log(`${promos.length} promotions`);
  const weeks = await scrapePromoRaw(page, PROMO, [CANCELLED_WEEK, ...WEEKS]);
  for (const w of weeks) {
    const name = w.weekStart === CANCELLED_WEEK ? 'cancelled.json' : `courses-${w.weekStart}.json`;
    const unknown = w.groups.filter((g) => !promos.includes(g));
    console.log(`${name}: ${w.weekLabel} — ${w.courses.length} cours, ${w.courses.filter((c) => c.cancelledMarker).length} annulé(s), groupes: ${w.groups.join(' | ')}${unknown.length ? ` (hors liste: ${unknown.join(' | ')})` : ''}`);
    const { disabled, ...fixture } = w;
    writeFileSync(new URL(name, dir), JSON.stringify({ promo: PROMO, ...fixture }, null, 2) + '\n');
  }
  // End-to-end check of the public API.
  const { courses, weeks: read } = await scrapePromo(page, PROMO, WEEKS);
  console.log(`scrapePromo: ${courses.length} cours, semaines lues: ${read.join(', ')}`);
} finally {
  await browser.close();
}
