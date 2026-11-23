// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTheme, setTheme } from '../../src/app/theme';

const metas = () => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => (m as HTMLMetaElement).content);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#F5F4F0">'
    + '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#121316">';
});
afterEach(() => vi.restoreAllMocks());

describe('theme', () => {
  it('get_defaults_to_auto', () => {
    expect(getTheme()).toBe('auto');
  });
  it('get_ignores_unknown_value', () => {
    localStorage.setItem('horaire.theme', 'bleu');
    expect(getTheme()).toBe('auto');
  });
  it('set_sombre_sets_attribute_and_metas', () => {
    setTheme('sombre');
    expect(localStorage.getItem('horaire.theme')).toBe('sombre');
    expect(document.documentElement.getAttribute('data-theme')).toBe('sombre');
    expect(metas()).toEqual(['#121316', '#121316']);
  });
  it('set_auto_removes_attribute_and_restores_metas', () => {
    setTheme('clair');
    expect(metas()).toEqual(['#F5F4F0', '#F5F4F0']);
    setTheme('auto');
    expect(localStorage.getItem('horaire.theme')).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(metas()).toEqual(['#F5F4F0', '#121316']);
  });
  it('storage_throwing_falls_back_to_auto', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(getTheme()).toBe('auto');
    expect(() => setTheme('sombre')).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('sombre');
  });
});
