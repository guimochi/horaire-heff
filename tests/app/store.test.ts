// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPromo, setPromo, getClearedAt, setClearedAt, onboardingStep } from '../../src/app/store';

const base = { standalone: true, isIOS: true, promo: 'BA3 - S3 - EPS', permission: 'default' as const, skippedNotifs: false };

describe('onboardingStep', () => {
  it('ios_not_standalone_is_install', () => {
    expect(onboardingStep({ ...base, standalone: false, promo: null })).toBe('install');
  });
  it('non_ios_not_standalone_without_promo_is_promo', () => {
    expect(onboardingStep({ ...base, standalone: false, isIOS: false, promo: null })).toBe('promo');
  });
  it('standalone_without_promo_is_promo', () => {
    expect(onboardingStep({ ...base, promo: null })).toBe('promo');
  });
  it('promo_and_default_permission_is_notifs', () => {
    expect(onboardingStep(base)).toBe('notifs');
  });
  it('promo_and_granted_is_done', () => {
    expect(onboardingStep({ ...base, permission: 'granted' })).toBe('done');
  });
  it('promo_default_skipped_is_done', () => {
    expect(onboardingStep({ ...base, skippedNotifs: true })).toBe('done');
  });
  it('unsupported_is_done', () => {
    expect(onboardingStep({ ...base, permission: 'unsupported' })).toBe('done');
  });
  it('denied_is_done', () => {
    expect(onboardingStep({ ...base, permission: 'denied' })).toBe('done');
  });
});

describe('localStorage keys', () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it('promo_round_trips', () => {
    expect(getPromo()).toBeNull();
    setPromo('BA3 - S3 - EPS');
    expect(localStorage.getItem('horaire.promo')).toBe('BA3 - S3 - EPS');
    expect(getPromo()).toBe('BA3 - S3 - EPS');
  });

  it('cleared_at_null_removes_key', () => {
    setClearedAt('2026-11-23T10:00:00Z');
    expect(getClearedAt()).toBe('2026-11-23T10:00:00Z');
    setClearedAt(null);
    expect(localStorage.getItem('horaire.clearedAt')).toBeNull();
  });

  it('unavailable_storage_falls_back', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    expect(getPromo()).toBeNull();
    expect(() => setPromo('X')).not.toThrow();
  });
});
