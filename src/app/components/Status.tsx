import type { Snapshot } from '../../shared/types';
import { HP_URL } from '../../shared/hp';
import { freshness } from '../model';
import { Icon } from './Icon';

/** Never a blank screen: loading, not synced yet (404, ruling R5), no week published, or offline with nothing cached. */
export function Calm({ kind, retry }: { kind: 'loading' | 'pending' | 'noweeks' | 'offline' | 'error'; retry?: () => void }) {
  if (kind === 'loading') return <p class="calm-state-loading" role="status">Chargement de ton horaire…</p>;
  if (kind === 'noweeks') {
    return (
      <div class="calm-state" role="status">
        <span class="calm-tile"><Icon name="week" size={34} /></span>
        <h2>Aucune semaine publiée pour l'instant</h2>
        <p>L'école n'a pas encore mis les prochaines semaines en ligne (congés, fin d'année). Ton horaire revient ici dès qu'elles le sont.</p>
      </div>
    );
  }
  if (kind === 'error') {
    return (
      <div class="calm-state" role="status">
        <span class="calm-tile"><Icon name="alert" size={34} /></span>
        <h2>Impossible de charger l'horaire pour l'instant</h2>
        {retry && <button type="button" class="btn-link" onClick={retry}>Réessayer</button>}
      </div>
    );
  }
  return (
    <div class="calm-state" role="status">
      <span class="calm-tile"><Icon name={kind === 'pending' ? 'clock' : 'offline'} size={34} /></span>
      {kind === 'pending' ? (
        <>
          <h2>Ton horaire arrive bientôt</h2>
          <p>La première lecture se fait au prochain passage : toutes les 30 min, de 6 h à 22 h, du lundi au samedi.</p>
        </>
      ) : (
        <>
          <h2>Pas de connexion</h2>
          <p>Ton horaire s'affichera dès que tu seras de nouveau en ligne.</p>
          {retry && <button type="button" class="btn-link" onClick={retry}>Réessayer</button>}
        </>
      )}
    </div>
  );
}

export function StaleBanner({ s, lastSuccess, now }: { s: Snapshot; lastSuccess: string | null; now: Date }) {
  if (!freshness(s, lastSuccess, now).stale) return null;
  return (
    <a class="banner tone-modified" href={HP_URL} target="_blank" rel="noopener">
      <Icon name="alert" size={22} />
      <span class="banner-text">Horaire peut-être pas à jour — vérifie sur Hyperplanning</span>
      <Icon name="external" size={18} width={2} />
    </a>
  );
}

export const Updated = ({ s, lastSuccess, now }: { s: Snapshot; lastSuccess: string | null; now: Date }) => (
  <p class="updated"><Icon name="refresh" size={14} width={2} />{freshness(s, lastSuccess, now).updated}</p>
);
