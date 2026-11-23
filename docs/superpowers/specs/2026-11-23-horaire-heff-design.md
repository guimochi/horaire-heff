# Horaire HEFF — design

Date : 2026-11-23
Maquette : https://claude.ai/artifact/B8kd5Kuq5SCwUDErMkZRFB (Claude Design, 6 écrans)

## Intention

Les étudiant·es de la HEFF consultent leur horaire sur l'espace invités Hyperplanning
(`https://heffpeda.hyperplanning.fr/hp/invite?fd=1`). Le site n'est pas pensé pour le
mobile, il faut taper `*` + Entrée pour lister les promotions, et surtout **aucune
notification** n'existe : comme des cours sont régulièrement annulés ou déplacés, il faut
vérifier la plateforme en permanence.

On construit une web app installable (PWA) pour iPhone qui :

1. affiche l'horaire du jour et de la semaine de la promotion **choisie**, lisible en un coup d'œil ;
2. **envoie une notification push** à chaque changement (annulation, ajout, heure, local,
   enseignant, autre champ).

Succès : on n'ouvre plus Hyperplanning ; on apprend une annulation par notification.

## Utilisateurs

- Utilisateurs : des étudiant·es de la HEFF, chacun sa promotion, surtout sur iPhone.
- Chacun choisit sa promotion une fois au premier lancement ; l'app n'affiche ensuite que
  celle-là (modifiable dans Réglages). Pas de compte, pas de connexion.
- Horaire commun à toute la promotion (pas de sous-groupes TD/options) : pas d'étape de
  choix de groupe ; on affiche tous les cours de la vue promotion d'Hyperplanning.

## Objectifs

- Vue **Jour** (par défaut) : cours du jour, cours en cours mis en avant avec progression,
  pauses, cours annulés barrés + étiquette « Annulé », bannière en haut s'il y a un
  changement aujourd'hui. Barre des jours lun.–sam. avec pastille sur les jours modifiés.
- Vue **Semaine** : liste par jour (pas de grille), navigation semaine précédente/suivante,
  étiquettes « Annulé », « Horaire », « Local » sur les cours modifiés.
- Vue **Changements** : fil des modifications, avant → après, horodaté, lien
  « Vérifier sur Hyperplanning ». Bouton « Tout effacer » : vide le fil sur cet appareil
  (date d'effacement en `localStorage` ; seuls les changements plus récents réapparaissent),
  écran vide « Tout est à jour » avec « Annuler ». Le badge de l'onglet se remet à zéro à
  l'ouverture de la vue. Les étiquettes « Annulé/Horaire/Local » dans Jour et Semaine
  restent affichées (elles décrivent l'horaire, pas le fil).
- **Premier lancement** en 3 étapes : (1) installer sur l'écran d'accueil (guide Safari),
  (2) choisir sa promotion avec recherche instantanée, (3) activer les notifications.
- Notifications push iOS (Web Push, iOS ≥ 16.4, app installée).
- « Mis à jour il y a X min » toujours visible ; fonctionne hors-ligne avec la dernière
  version connue.

## Non-objectifs (v1)

- Consulter d'autres promotions que la sienne, enseignants, salles.
- Comptes utilisateurs, synchro multi-appareils.
- App native / App Store.
- Android optimisé (doit fonctionner, mais pas testé en priorité).
- Mode sombre (souhaitable en v2).
- Export calendrier (iCal) côté utilisateur.

## Anti-objectifs (échec même si « ça marche »)

- **Fausse alerte massive** : une lecture ratée d'Hyperplanning (page vide, timeout,
  interface changée) ne doit **jamais** produire « tous tes cours sont annulés ».
- Horaire périmé affiché sans le dire : l'app l'indique clairement quand une exécution
  prévue du lecteur a été manquée (dernière lecture réussie plus ancienne que la plage
  attendue + 1 h). La nuit et le dimanche, pas d'alerte, puisqu'aucune lecture n'est
  prévue. *(choix du concepteur)*
- Spam : plusieurs changements détectés en même temps = une seule notification groupée.
- Notifications pour des cours passés.

## Contraintes trouvées

- L'espace invités est public, sans connexion.
- Les données viennent d'appels `POST /hp/appelfonction/...` chiffrés et liés à une
  session : impossible de les lire depuis le navigateur de l'utilisateur. Il faut une
  lecture côté serveur.
- Pas de version mobile d'Hyperplanning (`/hp/mobile.invite.html` → 404).
- Export iCal : une info-bulle « Exporter l'emploi du temps au format iCal » existe dans
  la page mais aucun bouton visible pour les invités. Probablement désactivé, non confirmé.
- ~100 promotions. Chaque cours affiche : matière, enseignant, promotion/groupe, salle,
  horaires (libellé accessible `Cours du 23 novembre de 8 heures 00 à 11 heures 00`).
- Sur iPhone, le stockage de Safari et celui de l'app installée sont séparés : le choix de
  promotion doit se faire **après** l'installation (d'où l'ordre des étapes).

## Approches considérées

| | Approche | Compromis | Choix |
|---|---|---|---|
| A | PWA installable + Web Push | Une seule app, gratuite, sans store. Sur iPhone : installation sur l'écran d'accueil obligatoire. | **Choisie** (utilisateurs sur iPhone) |
| B | PWA + notifications via Telegram / ntfy | Plus simple, mais deuxième app à installer, expérience moins fluide. | Écartée |
| C | App native (Expo) | Meilleure UX, mais compte Apple 99 $/an, validation, lourd pour le besoin. | Écartée |

Pour la lecture des données : navigateur automatisé (Playwright) qui lit la page invités,
plutôt que réimplémenter le protocole chiffré d'Hyperplanning (plus fragile et plus long).

## Architecture (décidée)

```
GitHub Actions (cron)            Cloudflare Pages + Functions + KV         iPhone (PWA)
┌──────────────────────┐  PUT   ┌──────────────────────────────┐  GET   ┌──────────────┐
│ Playwright lit       │──────▶│ /api/promos                   │◀──────│ Jour/Semaine │
│ Hyperplanning        │        │ /api/schedule/:promo          │        │ Changements  │
│ diff vs précédent    │        │ /api/changes/:promo           │  POST  │ Service      │
│ envoie Web Push      │◀──────│ /api/subscribe (promo+endpoint)│◀──────│ worker       │
└──────────────────────┘ subs   └──────────────────────────────┘        └──────────────┘
```

- **Lecteur (GitHub Actions, Node + Playwright)** : toutes les 30 min entre 6 h et 22 h
  (heure de Bruxelles), lun.–sam. Ne lit que les promotions qui ont au moins un abonné
  (+ la liste des promotions une fois par jour). Fenêtre : semaine courante + 3 suivantes.
  Repo public pour des minutes Actions illimitées (le code seul est public, les secrets non).
- **Diff** dans le job : compare au dernier instantané stocké, calcule les changements,
  envoie les push (`web-push`, clés VAPID en secrets), puis publie instantané + changements
  vers l'API (jeton secret).
- **API + hébergement (Cloudflare Pages + Functions + KV)** : sert la PWA statique, les
  données en lecture, et enregistre les abonnements push `{endpoint, keys, promo}`.
  Supprime les abonnements qui renvoient 404/410.
- **PWA** : Vite + Preact, service worker (cache de la dernière version, réception des push),
  `manifest.webmanifest` (icône, `display: standalone`). Choix de promotion en
  `localStorage`.

### Détection des changements (règles)

- Identité d'un cours : `date + matière + promotion/groupe`. Si la même matière apparaît
  deux fois le même jour, appariement dans l'ordre chronologique.
- Types : `annulé` (cours marqué annulé par Hyperplanning, ou disparu), `ajouté`,
  `horaire` (début/fin), `local`, `enseignant`, `autre` (tout autre champ affiché).
- Seuls les cours à venir (fin > maintenant) génèrent une notification ; tous les
  changements vont dans le fil.
- Cours déplacé à un autre jour : si, dans une même exécution et une même semaine, un cours
  `matière + groupe` disparaît d'un jour et apparaît un autre jour, on les apparie en un seul
  changement `déplacé` (« Cours déplacé — X · mardi 13:00 → jeudi 10:00 »). Sinon :
  `annulé` + `ajouté`. *(choix du concepteur)*
- **Garde-fou** : uniquement pour une lecture suspecte (échec, 0 cours pour une semaine qui
  en avait, ou perte de plus de 50 % des cours d'un coup) : on ne publie pas et on ne
  notifie pas, on garde la lecture « en attente ». Si la lecture suivante est identique,
  elle est confirmée et publiée (vraie annulation massive : grève, congé). Les changements
  normaux sont notifiés immédiatement. *(choix du concepteur)*
- Plusieurs changements dans une même exécution pour une promotion = une notification
  (« 3 changements dans ton horaire »), un seul = message détaillé (cf. maquette).

### Textes de notification

- Annulé : « Cours annulé — Act. gymniques 5 · aujourd'hui 13:00 n'aura pas lieu. »
- Local : « Changement de local — AFP 3 · jeudi 10:00 → local 2.1.04 (au lieu de 1.0.07). »
- Horaire : « Horaire modifié — Physiologie 5 · mardi : 14:00–17:00 (au lieu de 13:00–17:00). »
- Toucher la notification ouvre la vue Changements.

## Design visuel (décidé, voir maquette)

- Fond `#F5F4F0`, cartes blanches arrondies (20–22 px), texte `#15171C`, secondaire `#5C6070`.
- Accent bleu `#2447D6` (cours en cours, navigation active, boutons).
- Annulé : texte `#8F1D14` sur `#FDECEA`, contenu barré. Modifié : `#8A3A06` sur `#FFF0E3`.
  Toujours accompagné d'une étiquette texte (jamais la couleur seule).
- Titres Bricolage Grotesque, texte Inter. Cibles tactiles ≥ 44 px.
- Barre d'onglets : Jour · Semaine · Changements (badge du nombre non lu).
- Tutoiement, français.

## Laissé au développeur

- Vue Hyperplanning la plus simple à lire (« en grille » vs « en liste ») et sélecteurs.
- Format exact des instantanés et clés KV.
- Écran Réglages (changer de promotion, couper les notifications, lien Hyperplanning) :
  simple liste, non maquetté.
- Icône d'app et nom affiché sur l'écran d'accueil (proposition : « Horaire »).
- Nom de domaine (sous-domaine `*.pages.dev` par défaut).

## Risques

- Hyperplanning change son interface → le lecteur casse. Mitigation : alerte (issue GitHub
  ou e-mail au mainteneur) si 2 exécutions de suite échouent ; l'app affiche l'âge des données.
- GitHub désactive les cron des repos publics inactifs depuis 60 jours → prévoir un
  déclencheur externe ou un commit automatique mensuel.
- Les cron GitHub peuvent être retardés de quelques minutes à l'heure de pointe.
- Notifications iOS : uniquement si l'app est installée et iOS ≥ 16.4.
