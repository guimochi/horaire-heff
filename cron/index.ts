// Starts the sync workflow on time: GitHub's own `schedule` trigger drops runs (none on 2026-11-24 until noon).
// A dispatched run starts at once. Same slots as sync.yml; main.ts still filters to Brussels hours.
export const DISPATCH_URL = 'https://api.github.com/repos/guimochi/horaire-heff/actions/workflows/sync.yml/dispatches';

export async function dispatch(token: string, fetcher: typeof fetch = fetch): Promise<void> {
  const res = await fetcher(DISPATCH_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'horaire-heff-cron', 'x-github-api-version': '2022-11-28' },
    body: JSON.stringify({ ref: 'main' }),
  });
  // Thrown = the invocation shows as failed in the Worker's Cron Events (e.g. 401 once the token expires).
  if (!res.ok) throw new Error(`dispatch: HTTP ${res.status}`);
}

export default {
  async scheduled(_event: unknown, env: { GH_TOKEN: string }): Promise<void> {
    await dispatch(env.GH_TOKEN);
  },
};
