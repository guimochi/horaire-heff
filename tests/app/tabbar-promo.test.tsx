// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { TabBar, slideDir, swipeTarget } from '../../src/app/components/TabBar';
import { Promo } from '../../src/app/onboarding/Promo';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('TabBar badge', () => {
  it('badge_has_sr_only_text', () => {
    render(<TabBar route="jour" unread={3} />);
    const link = screen.getByRole('link', { name: /Changements/ });
    expect(link.textContent).toContain('3 non lus');
    expect(link.querySelector('.tab-badge')?.getAttribute('aria-hidden')).toBe('true');
  });
  it('no_badge_on_the_changes_tab_itself', () => {
    render(<TabBar route="changements" unread={3} />);
    expect(screen.getByRole('link', { name: /Changements/ }).textContent).toBe('Changements');
  });
});

describe('Promo from Réglages', () => {
  it('hides_step_label_and_settings_hint', () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    render(<Promo initial="BA3 - S3 - EPS" inSettings onDone={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Tu ne verras que celle-ci.')).toBeTruthy();
    expect(screen.queryByText(/Étape 2 sur 3/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeTruthy();
  });
});

describe('swipeTarget', () => {
  it('left_goes_to_next_tab_right_to_previous', () => {
    expect(swipeTarget('jour', -80, 5)).toBe('semaine');
    expect(swipeTarget('semaine', -80, 5)).toBe('changements');
    expect(swipeTarget('changements', 80, 5)).toBe('semaine');
  });
  it('stops_at_the_ends_and_ignores_settings', () => {
    expect(swipeTarget('jour', 80, 0)).toBeNull();
    expect(swipeTarget('changements', -80, 0)).toBeNull();
    expect(swipeTarget('reglages', -80, 0)).toBeNull();
  });
  it('ignores_short_or_vertical_moves', () => {
    expect(swipeTarget('jour', -40, 0)).toBeNull();
    expect(swipeTarget('jour', -80, 70)).toBeNull();
  });
});

describe('slideDir', () => {
  it('follows_tab_order_and_skips_settings', () => {
    expect(slideDir('jour', 'changements')).toBe('next');
    expect(slideDir('changements', 'semaine')).toBe('prev');
    expect(slideDir('reglages', 'jour')).toBeNull();
    expect(slideDir('jour', 'jour')).toBeNull();
  });
});
