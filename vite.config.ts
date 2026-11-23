import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import preact from '@preact/preset-vite';

// The `/*` block of public/_headers (Cloudflare Pages format), so `vite preview` runs the app under the same CSP.
function pagesHeaders(): Record<string, string> {
  const block = readFileSync('public/_headers', 'utf8').split(/^\/\*$/m)[1].split(/^\S/m)[0];
  return Object.fromEntries(block.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
}

export default defineConfig(({ command, mode }) => {
  // .env files are not in process.env here: read both.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  // A production build without the key ships an app whose « Activer les notifications » can never work.
  if (command === 'build' && mode === 'production' && !env.VITE_VAPID_PUBLIC_KEY && env.HORAIRE_ALLOW_NO_PUSH !== '1') {
    throw new Error('VITE_VAPID_PUBLIC_KEY is empty. Set it (DEPLOY.md), or HORAIRE_ALLOW_NO_PUSH=1 for a local or screenshot build.');
  }
  return {
    plugins: [preact()],
    preview: { headers: pagesHeaders() },
    // New id per build: main.tsx registers /sw.js?v=<id>, the new script URL installs a fresh SW with its own cache.
    define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(Date.now().toString(36)) },
  };
});
