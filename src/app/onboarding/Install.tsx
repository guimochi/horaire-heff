import { useState } from 'preact/hooks';

// Shown only in iOS Safari (not standalone). Safari's storage is not the installed app's, so this screen never
// advances: the button only points her to the home-screen icon.
export function Install() {
  const [ack, setAck] = useState(false);
  const now = new Date();
  const day = now.toLocaleDateString('fr-FR', { weekday: 'short' }).toUpperCase(); // « LUN. »
  const num = String(now.getDate());
  return (
    <div class="screen install">
      <div class="install-head">
        <div class="app-tile" aria-hidden="true">
          <span class="app-tile-day">{day}</span>
          <span class="app-tile-num">{num}</span>
        </div>
        <div class="install-text">
          <h1 class="title">Ton horaire HEFF, toujours à jour</h1>
          <p class="lead">Ajoute l'app à ton écran d'accueil pour être prévenue dès qu'un cours est annulé ou déplacé.</p>
        </div>
      </div>

      <ol class="install-steps">
        <li>
          <span class="install-num">1</span>
          <span class="install-step-text">Touche <strong>Partager</strong> en bas de Safari</span>
          <svg aria-hidden="true" class="icon-accent" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4" /><path d="M7 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" /></svg>
        </li>
        <li>
          <span class="install-num">2</span>
          <span class="install-step-text">Choisis <strong>Sur l'écran d'accueil</strong></span>
          <svg aria-hidden="true" class="icon-accent" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8v8M8 12h8" /></svg>
        </li>
        <li>
          <span class="install-num">3</span>
          <span class="install-step-text">Ouvre l'app depuis sa nouvelle icône</span>
          {/* The real home-screen icon, so she recognises it (mockup drew a dated tile). */}
          <img class="mini-icon" src="/apple-touch-icon.png" alt="" width="24" height="24" />
        </li>
      </ol>

      <button type="button" class="btn-link" onClick={() => setAck(true)}>C'est fait, continuer</button>
      {/* Always in the DOM so screen readers announce the text when it appears. */}
      <p class="install-ack" role="status">{ack && "Ouvre maintenant Horaire depuis sa nouvelle icône sur ton écran d'accueil."}</p>

      <div class="share-hint" aria-hidden="true">
        <span>Le bouton Partager est ici</span>
        <svg width="28" height="40" viewBox="0 0 28 40" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v34M5 27l9 9 9-9" /></svg>
      </div>
    </div>
  );
}
