// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { dayLabels, readList } from '../../src/sync/scrape';

// Shape of Hyperplanning's "Emploi du temps > en liste" (2026-11-24): rows own their cells through aria-owns.
let n = 0;
const cell = (html: string) => { const id = `c${n++}`; return { id, html: `<div id="${id}" role="gridcell">${html}</div>` }; };
const row = (cells: { id: string; html: string }[]) =>
  `<div role="row" aria-owns=" ${cells.map((c) => c.id).join(' ')}"></div>${cells.map((c) => c.html).join('')}`;
const heads = (names: string[]) => `<div role="row">${names.map((h) => `<div role="columnheader">${h}</div>`).join('')}</div>`;
const day = (label: string) => row([cell(`<div><i role="img"></i></div><div><div><span> ${label}</span></div></div>`)]);
const course = (time: string, teachers: string[], room: string, cancelled = false) => row([
  cell(`<div><div><div>${time}${cancelled ? '<span role="note">Annulé</span>' : ''}</div></div></div>`),
  cell('<div><div>&nbsp;</div></div>'),
  cell('<div><div><div><div></div>AFP 1</div></div></div>'),
  cell(`<div><div><div>${teachers.map((t) => `<div>${t}</div>`).join('')}</div></div></div>`),
  cell(`<div><div><div>${room}</div></div></div>`),
]);
const list = (html: string) => { document.body.innerHTML = `<main>${html}</main>`; return readList(document.querySelector('main')!); };

afterEach(() => { document.body.innerHTML = ''; });

describe('readList', () => {
  it('reads every name of the Enseignant column, the course rows and the dates', () => {
    const r = list(heads(['Horaires', 'Classe', 'Matière', 'Enseignant', 'Salle']) +
      day('mardi 1er décembre 2026') +
      course('09h00 - 12h00', ['Leroy Anne', 'Renard Hélène'], '1.1.06', true) +
      course('13h00 - 16h00', ['Leroy Anne'], 'Gymnase Buls'));
    expect(r).toStrictEqual({ col: 3, rows: 2, days: ['1 décembre 2026'], teachers: ['Leroy Anne', 'Renard Hélène'] });
  });
  it('a week without any teacher: Hyperplanning hides the column, no name is read', () => {
    const r = list(heads(['Horaires', 'Classe', 'Matière', 'Salle']) + day('lundi 23 novembre 2026') + course('08h00 - 20h00', [], ''));
    expect(r).toMatchObject({ col: -1, rows: 1, teachers: [] });
  });
});

describe('week check', () => {
  // The list starts on the last week read; "22 mars" must not pass for "2 mars" (months starting on a Monday).
  it('a date of another week never matches', () => {
    const stale = list(heads(['Horaires', 'Enseignant']) + day('lundi 22 mars 2027')).days;
    expect(stale).toStrictEqual(['22 mars 2027']);
    expect(stale.every((d) => dayLabels('2027-03-01').includes(d))).toBe(false);
    expect(stale.every((d) => dayLabels('2027-03-22').includes(d))).toBe(true);
  });
});
