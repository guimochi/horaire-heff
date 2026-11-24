# Mise en ligne

Trois morceaux : l'API et la PWA sur Cloudflare Pages (avec un KV), la synchronisation sur GitHub Actions.

## 1. Clés VAPID et KV

```sh
npx web-push generate-vapid-keys          # garde la clé publique et la clé privée
npx wrangler kv namespace create HORAIRE  # affiche l'id du namespace
```

Dans `wrangler.toml`, remplace `REPLACE_AT_DEPLOY` par cet id.

## 2. Projet Cloudflare Pages

Relie le projet au repo GitHub, puis règle :

- commande de build : `npm run build` ;
- dossier de sortie : `dist` ;
- version de Node : 22 (le fichier `.node-version` du repo la donne, sinon variable `NODE_VERSION=22`) ;
- variable `VITE_VAPID_PUBLIC_KEY` : la clé publique VAPID, dans `[vars]` de `wrangler.toml` (Pages lit ce fichier et ignore alors les variables du tableau de bord) ;
- secret `ADMIN_TOKEN` : une valeur aléatoire, par exemple `openssl rand -hex 32` ;
- liaison KV `HORAIRE` vers le namespace créé à l'étape 1.

Le build de production échoue si `VITE_VAPID_PUBLIC_KEY` est vide, pour qu'une app sans notifications ne parte pas en ligne par erreur. Pour un build local ou pour des captures d'écran, lance `HORAIRE_ALLOW_NO_PUSH=1 npm run build`.

## 3. Secrets GitHub Actions

Dans Settings, Secrets and variables, Actions :

| Secret | Valeur |
| --- | --- |
| `ADMIN_TOKEN` | le même que sur Pages |
| `VAPID_PUBLIC_KEY` | la clé publique VAPID, **identique** à `VITE_VAPID_PUBLIC_KEY` dans `wrangler.toml` |
| `VAPID_PRIVATE_KEY` | la clé privée VAPID |
| `VAPID_SUBJECT` | `mailto:` suivi d'une adresse de contact |
| `API_BASE` | l'URL du site, par exemple `https://horaire-heff.pages.dev` |

Si les deux clés publiques diffèrent, les abonnements sont créés avec une clé et les envois signés avec l'autre : aucune notification n'arrive.

## 4. Workflows planifiés

- GitHub ne lance les workflows planifiés (`sync`, `keepalive`) que depuis la branche par défaut. Fusionne d'abord dans `main`.
- `keepalive` pousse un commit par mois sur la branche par défaut, pour que GitHub ne désactive pas les crons après 60 jours sans activité. Si la branche est protégée, autorise `github-actions[bot]` à y pousser, sinon `keepalive` échoue.
- `sync` tourne aux minutes 4 et 34, de 6 h à 22 h (heure de Bruxelles), du lundi au samedi. Un run dure 15 min au plus : au-delà, les promotions restantes sont sautées et lues au passage suivant.
- **Le planning de GitHub ne suffit pas** : il retarde ou saute des runs sans prévenir (le 24/11/2026, aucun run planifié avant midi). Le Worker `cron/` (Cloudflare) lance donc `sync` par `workflow_dispatch` aux mêmes minutes. Le cron GitHub reste en secours.
  1. Crée un jeton GitHub *fine-grained* : dépôt `horaire-heff` seulement, permission **Actions : Read and write**, expiration 1 an (note la date : à son expiration, la synchro s'arrête et l'app affiche « peut-être pas à jour »).
  2. `npx wrangler deploy -c cron/wrangler.toml`
  3. `npx wrangler secret put GH_TOKEN -c cron/wrangler.toml` (colle le jeton).
  4. Vérifie : Workers & Pages › `horaire-heff-cron` › Cron Events, puis un run `workflow_dispatch` toutes les 30 min dans l'onglet Actions.
- **Après un changement du lecteur** qui modifie des valeurs déjà publiées (ex. un prof lu comme local) : lance une fois `gh workflow run sync -f silent=true`. Le run publie la nouvelle lecture sans créer de changements ni notifier.

## 5. Risque d'abus restant

`POST /api/subscribe` est public. Ce qui est en place :

- seules les requêtes du site lui-même passent (`Sec-Fetch-Site` et `Content-Type: application/json` exigés), avec des clés au format d'un vrai abonnement push ;
- l'API limite chaque IP (chaque /64 en IPv6) à 10 écritures par heure. Un ré-abonnement identique ne compte pas et n'écrit rien (au plus une écriture par appareil et par mois) ;
- un abonnement expire après 90 jours sans ré-enregistrement, et le job lit au plus 20 promotions abonnées par passage, les plus anciennes d'abord : un faux abonnement ne repousse jamais un vrai.

Le compteur passe par le cache de Cloudflare : il est propre à chaque centre de données, il n'est pas atomique (des requêtes en parallèle lisent le même compte), et il peut ne rien compter sur un domaine `*.pages.dev`. Quelqu'un de déterminé peut donc encore épuiser les 1000 écritures KV par jour de l'offre gratuite. **L'effet réel** : les écritures du job de synchronisation échouent aussi jusqu'au lendemain (horaires, changements, `meta:reads`). Aucun changement n'est enregistré ni notifié, et l'app affiche un horaire de plus en plus ancien. Les horaires déjà publiés restent lisibles.

Les vraies parades, à mettre en place si cela arrive :

- **Cloudflare Turnstile** sur le bouton « Activer les notifications », vérifié côté serveur avant l'écriture dans le KV. Il faut le compte Cloudflare du mainteneur (clé de site et clé secrète). Cela ne coûte aucune écriture et arrête les abonnements en masse par script ;
- **domaine personnalisé + WAF** : sers le site sur un domaine géré par Cloudflare, puis ajoute une règle de limitation de débit (Security, WAF, Rate limiting rules) sur `/api/subscribe`. Attention : l'offre gratuite ne propose peut-être qu'une période de comptage de 10 secondes ; « 10 requêtes par heure et par IP » peut demander une offre payante. Vérifie dans le tableau de bord avant de compter dessus.

## 5 bis. Interventions manuelles

Les deux appels prennent l'en-tête `Authorization: Bearer <ADMIN_TOKEN>`.

- **Liste des promotions refusée** (une promotion suivie disparaît, ou plus de 10 % de la liste) : le job garde la nouvelle liste « en attente » et l'accepte s'il relit la même au passage suivant. Pour l'imposer tout de suite :

  ```sh
  curl -X PUT "$API_BASE/api/admin/promos" -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H 'content-type: application/json' --data '["<promotion 1>", "<promotion 2>", "…"]'
  ```

  Donne la liste complète, telle que l'affiche Hyperplanning.
- **Semaine vidée** (une semaine qui avait des cours se lit vide) : le job publie les autres semaines, garde l'ancienne version de celle-ci et ne prévient qu'une fois. Si la semaine a vraiment été vidée, publie la lecture en attente : `GET /api/admin/state/<promotion encodée>`, puis `PUT` au même chemin avec `{"snapshot": <le pending lu>, "pending": null}`.

## 5 ter. À faire

- Épingler les actions GitHub (`actions/checkout`, `actions/setup-node`) sur un SHA de commit complet, avec le tag en commentaire (`# v4.x.y`). Dependabot (`.github/dependabot.yml`) les mettra ensuite à jour.

## 6. Recette sur iPhone

1. Lance `sync` à la main (Actions, sync, Run workflow). `GET /api/promos` doit renvoyer une centaine de promotions.
2. Sur un iPhone avec iOS 16.4 ou plus récent, ouvre l'URL dans Safari : l'écran Installer s'affiche. Ajoute le site à l'écran d'accueil, puis ouvre-le depuis l'icône. Choisis `<ta promotion>`, touche « Activer les notifications » et accepte. Relance `sync` : l'horaire apparaît dans Jour et Semaine.
3. Test de notification : envoie un `PUT /api/admin/state/<ta promotion encodée>` (espaces en `%20` ; en-tête `Authorization: Bearer <ADMIN_TOKEN>`) avec un `snapshot` où un cours futur a un autre local. Relance `sync` : la notification « Changement de local » arrive, et la toucher ouvre Changements.

## 7. Vérifier au déploiement

- [ ] 11 `POST /api/subscribe` à la suite depuis une même IP (11 abonnements différents, en-têtes `content-type: application/json`) : le 11e répond 429. Sinon, le compteur ne compte pas sur ce domaine (voir §5).
- [ ] 30 `POST /api/subscribe` en parallèle : compte les 204. Plus de 10 = la course du compteur est réelle (voir §5).
- [ ] `_headers` ne s'applique qu'aux fichiers statiques : `curl -I` sur `/` montre `Content-Security-Policy` et `X-Frame-Options`, `/sw.js` montre `Cache-Control: no-cache`, et `/api/promos` montre `x-content-type-options: nosniff` (posé par le code).
- [ ] Sur l'iPhone, l'app installée n'affiche aucune erreur CSP dans la console (Safari, Développement, l'iPhone), sur Jour, Semaine, Changements et Réglages.
- [ ] Les polices s'affichent hors ligne : mode Avion, puis ouvre l'app depuis l'icône.
