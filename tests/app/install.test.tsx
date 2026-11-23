// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { App } from '../../src/app/App';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

describe('install step in iOS Safari', () => {
  beforeEach(() => { Object.defineProperty(navigator, 'userAgent', { value: IPHONE_UA, configurable: true }); });
  afterEach(() => { cleanup(); localStorage.clear(); });

  it('continue_does_not_leave_install_and_points_to_the_icon', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: "C'est fait, continuer" }));
    expect(screen.getByRole('status').textContent).toBe("Ouvre maintenant Horaire depuis sa nouvelle icône sur ton écran d'accueil.");
    expect(screen.getByRole('heading').textContent).toBe('Ton horaire HEFF, toujours à jour');
    expect(screen.queryByText('Quelle est ta promotion ?')).toBeNull();
  });
});
