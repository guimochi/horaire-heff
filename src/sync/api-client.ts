import type { Change, PushSub, Snapshot } from '../shared/types';

export type ApiClient = {
  getPromos(): Promise<string[]>; putPromos(p: string[]): Promise<void>;
  getPromosPending(): Promise<string[] | null>; putPromosPending(p: string[] | null): Promise<void>;
  getState(promo: string): Promise<{ snapshot: Snapshot | null; pending: Snapshot | null }>;
  putState(promo: string, body: { snapshot?: Snapshot; pending?: Snapshot | null; newChanges?: Change[] }): Promise<void>;
  getSubs(): Promise<{ hash: string; promo: string; subscription: PushSub; at: string /*first subscribe*/ }[]>; deleteSub(hash: string): Promise<void>;
  getWatched(): Promise<{ promo: string; first: string; last: string }[]>; putReads(reads: Record<string, string>): Promise<void>;
};

export function createApiClient(base: string, token: string): ApiClient {
  const root = base.replace(/\/+$/, '');
  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = {};
    if (path.startsWith('/api/admin/')) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(root + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new Error(`API ${method} ${path} -> ${res.status}`);
    return res.status === 204 ? undefined : res.json();
  };
  const state = (promo: string) => `/api/admin/state/${encodeURIComponent(promo)}`;
  return {
    getPromos: () => call('GET', '/api/promos'),
    putPromos: async (p) => { await call('PUT', '/api/admin/promos', p); },
    getPromosPending: () => call('GET', '/api/admin/promos-pending'),
    putPromosPending: async (p) => { await call('PUT', '/api/admin/promos-pending', p); },
    getState: (promo) => call('GET', state(promo)),
    putState: async (promo, body) => { await call('PUT', state(promo), body); },
    getSubs: () => call('GET', '/api/admin/subs'),
    deleteSub: async (hash) => { await call('DELETE', `/api/admin/subs/${encodeURIComponent(hash)}`); },
    getWatched: () => call('GET', '/api/admin/watched'),
    putReads: async (reads) => { await call('PUT', '/api/admin/reads', reads); },
  };
}
