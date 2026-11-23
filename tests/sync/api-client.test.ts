import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApiClient } from '../../src/sync/api-client';

afterEach(() => { vi.unstubAllGlobals(); });

function stub(status: number, json: unknown = null) {
  const f = vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(status === 204 ? null : JSON.stringify(json), { status }));
  vi.stubGlobal('fetch', f);
  return f;
}

describe('createApiClient', () => {
  it('encodes_promo_and_sends_bearer_on_admin_routes', async () => {
    const f = stub(200, { snapshot: null, pending: null });
    const api = createApiClient('https://x.pages.dev/', 'tok');
    expect(await api.getState('BA3 - S3/EPS')).toStrictEqual({ snapshot: null, pending: null });
    expect(f.mock.calls[0][0]).toBe('https://x.pages.dev/api/admin/state/BA3%20-%20S3%2FEPS');
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: { authorization: 'Bearer tok' } });
  });
  it('public_promos_has_no_token_and_204_has_no_body', async () => {
    const f = stub(200, []);
    const api = createApiClient('https://x.pages.dev', 'tok');
    expect(await api.getPromos()).toStrictEqual([]);
    expect(f.mock.calls[0][1].headers).toStrictEqual({});
    const g = stub(204);
    await expect(api.putPromos(['A'])).resolves.toBeUndefined();
    expect(g.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: '["A"]' });
  });
  it('error_status_throws_without_token', async () => {
    stub(404);
    await expect(createApiClient('https://x.pages.dev', 'tok').deleteSub('h1')).rejects.toThrow(/DELETE \/api\/admin\/subs\/h1 -> 404/);
    await expect(createApiClient('https://x.pages.dev', 'tok').deleteSub('h1')).rejects.not.toThrow(/tok/);
  });
  it('promos_pending_routes', async () => {
    const f = stub(200, ['A']);
    const api = createApiClient('https://x.pages.dev', 'tok');
    expect(await api.getPromosPending()).toStrictEqual(['A']);
    expect(f.mock.calls[0][0]).toBe('https://x.pages.dev/api/admin/promos-pending');
    const g = stub(204);
    await api.putPromosPending(null);
    expect(g.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: 'null', headers: { authorization: 'Bearer tok' } });
  });
  it('watched_and_read_routes', async () => {
    const f = stub(200, [{ promo: 'A', at: 'T' }]);
    const api = createApiClient('https://x.pages.dev', 'tok');
    expect(await api.getWatched()).toStrictEqual([{ promo: 'A', at: 'T' }]);
    expect(f.mock.calls[0][0]).toBe('https://x.pages.dev/api/admin/watched');
    const g = stub(204);
    await api.putReads({ 'BA3 - S3/EPS': '2026-11-23T09:00:00.000Z' });
    expect(g.mock.calls[0][0]).toBe('https://x.pages.dev/api/admin/reads');
    expect(g.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: '{"BA3 - S3/EPS":"2026-11-23T09:00:00.000Z"}', headers: { authorization: 'Bearer tok' } });
  });
});
