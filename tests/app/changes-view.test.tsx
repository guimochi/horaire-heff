// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'preact/hooks';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { Change, Course } from '../../src/shared/types';
import { Changes } from '../../src/app/views/Changes';

const course = (subject: string, date: string, start: string, end: string, room: string): Course =>
  ({ date, start, end, subject, teacher: '', room, group: '3 EDP', cancelled: false, extra: [] });
const gym = course('Act. gymniques 5', '2026-11-23', '13:00', '16:00', 'Gymnase Buls');
const afp = course('AFP 3', '2026-11-26', '10:00', '12:00', '2.1.04');
const physio = course('Physiologie 5', '2026-11-24', '14:00', '17:00', '3.2.01');
const CHANGES: Change[] = [
  { id: 'a', kind: 'annule', promo: 'BA3 - S3 - EPS', detectedAt: '2026-11-23T08:28:00.000Z', before: gym, after: { ...gym, cancelled: true } },
  { id: 'l', kind: 'local', promo: 'BA3 - S3 - EPS', detectedAt: '2026-11-23T08:28:00.000Z', before: { ...afp, room: '1.0.07' }, after: afp },
  { id: 'h', kind: 'horaire', promo: 'BA3 - S3 - EPS', detectedAt: '2026-11-22T17:40:00.000Z', before: { ...physio, start: '13:00' }, after: physio },
];
const NOW = new Date('2026-11-23T08:40:00Z');

function Harness({ changes = CHANGES, now = NOW }: { changes?: Change[]; now?: Date }) {
  const [clearedAt, setClearedAt] = useState<string | null>(null);
  return <Changes promo="BA3 - S3 - EPS" changes={changes} now={now} seenBefore={null} clearedAt={clearedAt} setClearedAt={setClearedAt} />;
}

describe('Changes view', () => {
  afterEach(() => cleanup());

  it('clear_all_then_undo_restores_the_three_changes', () => {
    render(<Harness />);
    expect(screen.getAllByRole('article')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Tout effacer' }));
    expect(screen.getByText('Tout est à jour')).toBeTruthy();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByText('Cours annulé')).toBeTruthy();
    expect(screen.getByText('Local modifié')).toBeTruthy();
    expect(screen.getByText('Horaire modifié')).toBeTruthy();
  });

  it('clear_uses_newest_detectedAt_not_device_clock', () => {
    // Change A detected at T, loaded and cleared at T+5 min. Change B detected at T+1 min lands later (slow KV write).
    const T = '2026-11-23T08:00:00.000Z';
    const a: Change = { ...CHANGES[0], id: 'A', detectedAt: T };
    const b: Change = { ...CHANGES[1], id: 'B', detectedAt: '2026-11-23T08:01:00.000Z' };
    const plus5 = new Date('2026-11-23T08:05:00Z');
    const { rerender } = render(<Harness changes={[a]} now={plus5} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tout effacer' }));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    rerender(<Harness changes={[b, a]} now={plus5} />);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Local modifié')).toBeTruthy();
  });

  it('empty_feed_has_no_undo', () => {
    render(<Changes promo="BA3 - S3 - EPS" changes={[]} now={NOW} seenBefore={null} clearedAt={null} setClearedAt={() => {}} />);
    expect(screen.getByText('Tout est à jour')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
  });
});
