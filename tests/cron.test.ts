import { describe, expect, it, vi } from 'vitest';
import { dispatch, DISPATCH_URL } from '../cron/index';

describe('cron dispatch', () => {
  it('dispatches sync.yml on main with the token', async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    await dispatch('tok', f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DISPATCH_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toStrictEqual({ ref: 'main' });
  });
  it('fails loudly on a refused dispatch (expired token)', async () => {
    const f = vi.fn(async () => new Response(null, { status: 401 }));
    await expect(dispatch('old', f as unknown as typeof fetch)).rejects.toThrow('HTTP 401');
  });
});
