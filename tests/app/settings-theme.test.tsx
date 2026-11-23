// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { Settings } from '../../src/app/views/Settings';

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });
afterEach(cleanup);

const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

describe('Réglages · Apparence', () => {
  it('shows_auto_pressed_by_default', () => {
    render(<Settings promo="BA3 - S3 - EPS" onPromo={() => {}} />);
    expect(pressed('Auto')).toBe('true');
    expect(pressed('Clair')).toBe('false');
    expect(screen.getByText("Suit le réglage de l'iPhone.")).toBeTruthy();
  });
  it('click_sombre_saves_and_applies', () => {
    render(<Settings promo="BA3 - S3 - EPS" onPromo={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sombre' }));
    expect(localStorage.getItem('horaire.theme')).toBe('sombre');
    expect(document.documentElement.getAttribute('data-theme')).toBe('sombre');
    expect(pressed('Sombre')).toBe('true');
    expect(screen.getByText("Toujours sombre, même quand l'iPhone est en mode clair.")).toBeTruthy();
  });
  it('click_auto_clears', () => {
    localStorage.setItem('horaire.theme', 'clair');
    render(<Settings promo="BA3 - S3 - EPS" onPromo={() => {}} />);
    expect(pressed('Clair')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
    expect(localStorage.getItem('horaire.theme')).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
