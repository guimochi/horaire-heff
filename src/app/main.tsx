import { render } from 'preact';
import { App } from './App';
// Self-hosted (no third-party request carrying the student's IP), Latin subset, only the weights styles.css uses.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/bricolage-grotesque/latin-600.css';
import '@fontsource/bricolage-grotesque/latin-700.css';
import './styles.css';

render(<App />, document.getElementById('app')!);

// Production only: a dev SW would serve stale modules. The build id in the URL makes each deploy a new SW + cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`/sw.js?v=${import.meta.env.VITE_BUILD_ID}`).catch(() => {});
}
