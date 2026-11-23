# Horaire HEFF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PWA iPhone qui affiche l'horaire Hyperplanning d'une promotion HEFF (jour/semaine) et envoie une notification push à chaque changement.

**Architecture:** Un job GitHub Actions (Node + Playwright) lit l'espace invités Hyperplanning toutes les 30 min, compare au dernier instantané, envoie les Web Push et publie l'instantané via une API Cloudflare Pages Functions + KV. La PWA (Vite + Preact) est servie par Cloudflare Pages et lit cette API.

**Tech Stack:** TypeScript, Node 20, Vitest, Playwright (chromium), `web-push`, Cloudflare Pages + Pages Functions + KV (`wrangler`), Vite, Preact, `@testing-library/preact`.

**Spec:** `docs/superpowers/specs/2026-11-23-horaire-heff-design.md`
**Maquette (source de vérité visuelle) :** https://claude.ai/artifact/B8kd5Kuq5SCwUDErMkZRFB — copies locales des écrans : `design/*.dc.html` (copiées en Task 1).

## Global Constraints

- Source : `https://heffpeda.hyperplanning.fr/hp/invite?fd=1` (public, sans connexion). Ne jamais tenter d'autre URL Hyperplanning.
- Lecture toutes les 30 min, lun.–sam., 6 h–22 h heure de `Europe/Brussels` ; fenêtre = semaine courante + 3 suivantes.
- Ne lire que les promotions qui ont ≥ 1 abonné ; liste des promotions relue une fois par jour (première exécution après 6 h) ou si absente.
- Notifications uniquement pour les cours dont la fin est > maintenant ; tous les changements vont dans le fil.
- Plusieurs changements pour une promotion dans une même exécution = 1 seule notification groupée.
- Copie notifications (exacte) : voir Task 5.
- UI : tutoiement, français ; couleurs/typo/espacements = maquette (`#F5F4F0`, `#15171C`, `#5C6070`, accent `#2447D6`, annulé `#8F1D14`/`#FDECEA`, modifié `#8A3A06`/`#FFF0E3`, Bricolage Grotesque + Inter) ; cibles tactiles ≥ 44 px ; état jamais signalé par la couleur seule.
- Pas de compte utilisateur. Promotion choisie en `localStorage` clé `horaire.promo`.
- KV gratuit = 1000 écritures/jour : n'écrire un instantané/fil que s'il a changé ; une seule clé `meta:lastSuccess` par exécution.
- Aucune donnée personnelle de l'utilisateur dans le code ou les en-têtes (VAPID subject fourni par secret `VAPID_SUBJECT`).
- Secrets : `ADMIN_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `API_BASE`.

## Review Focus

1. **Nouvelle semaine qui entre dans la fenêtre** : ne doit produire aucun « Cours ajouté » ; seules les semaines présentes dans les deux instantanés sont comparées. → test en Task 3.
2. **Lecture vide / Hyperplanning en panne** : aucune notification, aucun instantané publié ; confirmé seulement après 2 lectures identiques. → tests en Task 4.
3. **Même matière deux fois le même jour** (ex. « Diff des apprentissages » 08:00 et 14:00) : appariement chronologique, pas de faux « horaire modifié ». → test en Task 3.
4. **Jour sans cours (dimanche, vendredi vide)** : la vue Jour affiche « Pas de cours » + le prochain cours, jamais un écran blanc. → test en Task 9.
5. **Abonnement push expiré (404/410)** : supprimé sans faire échouer l'exécution ni bloquer les autres envois. → test en Task 7.

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, vitest.config.ts, wrangler.toml
design/*.dc.html                      copies de la maquette (référence)
src/shared/types.ts                   Course, Snapshot, Change, ChangeKind, PushSub
src/shared/time.ts                    brusselsNow(), isInRunWindow(), nextSlotAfter(), isStale()
src/sync/parse.ts                     parseCourse(raw, weekStart) -> Course
src/sync/scrape.ts                    scrapePromoList(page), scrapePromo(page, promo, weeks)
src/sync/diff.ts                      courseKey(), diffSnapshots()
src/sync/guard.ts                     isSuspicious(), decidePublish()
src/sync/notify-text.ts               notificationFor()
src/sync/push.ts                      sendAll()
src/sync/api-client.ts                getState(), putState(), getSubs(), deleteSub(), putPromos(), putLastSuccess()
src/sync/main.ts                      orchestration
scripts/capture-fixtures.ts           capture DOM brut Hyperplanning -> tests/fixtures
functions/api/[[route]].ts            API Pages Functions (un seul routeur)
src/app/main.tsx, App.tsx, store.ts   PWA : état, routage hash
src/app/onboarding/{Install,Promo,Notifs}.tsx
src/app/views/{Day,Week,Changes}.tsx, components/{CourseCard,TabBar}.tsx
src/app/model.ts                      dayModel(), weekModel(), changesModel()
src/app/push.ts                       subscribe()
public/sw.js, public/manifest.webmanifest, public/icon-*.png
.github/workflows/sync.yml, .github/workflows/keepalive.yml
tests/**                              miroir de src/
```

---

### Task 1: Socle du projet + types partagés + temps Bruxelles

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/shared/types.ts`, `src/shared/time.ts` (`design/` contient déjà les 6 écrans de la maquette)
- Test: `tests/shared/time.test.ts`

**Interfaces:**
- Produces:
```ts
export type Course = { date: string /*YYYY-MM-DD*/; start: string /*HH:MM*/; end: string; subject: string;
  teacher: string; room: string; group: string; cancelled: boolean; extra: string[] };
export type Snapshot = { promo: string; fetchedAt: string /*ISO*/; weeks: string[] /*lundis YYYY-MM-DD*/; courses: Course[] };
export type ChangeKind = 'annule' | 'ajoute' | 'horaire' | 'local' | 'enseignant' | 'deplace' | 'autre';
export type Change = { id: string; kind: ChangeKind; promo: string; detectedAt: string; before: Course | null; after: Course | null };
export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };
// time.ts — tout en Europe/Brussels
export function brusselsParts(d: Date): { date: string; weekday: number /*1=lun..7=dim*/; hour: number; minute: number };
export function isInRunWindow(d: Date): boolean;        // lun–sam, 06:00 <= t < 22:30 (tolère un job de 22:00 en retard)
export function nextSlotAfter(d: Date): Date;           // prochain créneau prévu, strictement après d ; créneaux = lun–sam 06:00, 06:30 … 22:00
export function isStale(fetchedAt: Date, now: Date): boolean; // now - nextSlotAfter(fetchedAt) > 60 min
export function mondayOf(dateIso: string): string;
```

- [ ] **Step 1:** `git init`, `npm init -y`, installer `typescript vitest @types/node` ; scripts `test`, `typecheck` (`tsc --noEmit`). `.gitignore` : `node_modules dist .wrangler .env`.
- [ ] **Step 2: Tests qui échouent** (`tests/shared/time.test.ts`) — dates en heure de Bruxelles (CET, UTC+1 en novembre) :
```ts
expect(isInRunWindow(new Date('2026-11-23T09:40:00+01:00'))).toBe(true);   // lundi
expect(isInRunWindow(new Date('2026-11-29T12:00:00+01:00'))).toBe(false);  // dimanche
expect(isInRunWindow(new Date('2026-11-23T05:59:00+01:00'))).toBe(false);
expect(nextSlotAfter(new Date('2026-11-28T21:40:00+01:00')).toISOString()).toBe('2026-11-28T21:00:00.000Z'); // sam 22:00 local
expect(nextSlotAfter(new Date('2026-11-28T22:00:00+01:00')).toISOString()).toBe('2026-11-30T05:00:00.000Z'); // lun 06:00 local
expect(isStale(new Date('2026-11-28T22:00:00+01:00'), new Date('2026-11-29T12:00:00+01:00'))).toBe(false); // dimanche
expect(isStale(new Date('2026-11-30T08:30:00+01:00'), new Date('2026-11-30T10:01:00+01:00'))).toBe(true);
expect(isStale(new Date('2026-11-30T08:30:00+01:00'), new Date('2026-11-30T10:00:00+01:00'))).toBe(false);
expect(isStale(new Date('2026-11-28T22:00:00+01:00'), new Date('2026-11-30T06:10:00+01:00'))).toBe(false);
expect(mondayOf('2026-11-26')).toBe('2026-11-23');
```
- [ ] **Step 3:** `npx vitest run tests/shared` → FAIL (module absent).
- [ ] **Step 4:** Implémenter `types.ts` et `time.ts` avec `Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', ... })` (pas de lib de dates).
- [ ] **Step 5:** `npx vitest run tests/shared && npm run typecheck` → PASS.
- [ ] **Step 6:** `git add -A && git commit -m "chore: scaffold, shared types, Brussels time helpers"`

---

### Task 2: Lecture Hyperplanning (capture + parsing + scraping)

**Files:**
- Create: `scripts/capture-fixtures.ts`, `src/sync/parse.ts`, `src/sync/scrape.ts`, `tests/fixtures/courses-*.json`
- Test: `tests/sync/parse.test.ts`

**Interfaces:**
- Consumes: `Course` (Task 1)
- Produces:
```ts
export type RawCourse = { aria: string; lines: string[]; cancelledMarker: boolean };
export function parseCourse(raw: RawCourse, weekStart: string /*YYYY-MM-DD*/): Course;
export async function scrapePromoList(page: Page): Promise<string[]>;
export async function scrapePromo(page: Page, promo: string, weeks: string[]): Promise<Course[]>; // throws on any failure
```

Faits observés sur la page (2026-11-23) :
- Popup cookies au chargement → bouton « Fermer ».
- Combobox accessible « Sélectionnez une [classe] » ; taper `*` + Entrée liste toutes les promotions (~100).
- Semaines : listbox « Multi-séléction de semaines… », options libellées `Semaine 12, du 23/11/2026 au 28/11/2026`.
- Cours : élément avec `aria-label` `Cours du 23 novembre de 8 heures 00 à 11 heures 00` ; texte interne sur lignes : matière, enseignant, groupe, salle (ex. `Diff des apprentissages / Leroy Anne / BA3 - S3 - EPS / 3.1.01`).
- Bouton « Afficher les cours annulés » : doit être actif pendant la lecture.

- [ ] **Step 1:** Installer `playwright` (`npx playwright install chromium`). Écrire `scripts/capture-fixtures.ts` : ouvre la page, ferme le popup, sélectionne `BA3 - S3 - EPS`, active « Afficher les cours annulés », pour 4 semaines collecte `RawCourse[]` (+ libellé de semaine) et écrit `tests/fixtures/courses-<semaine>.json`. Lancer `npx tsx scripts/capture-fixtures.ts`. Chercher via le menu « Cours annulés » une promo ayant un cours annulé et capturer aussi ce cas (`tests/fixtures/cancelled.json`) pour connaître le marqueur réel (classe CSS, texte, icône) → c'est lui qui définit `cancelledMarker`.
- [ ] **Step 2: Tests qui échouent** (`tests/sync/parse.test.ts`) :
```ts
const raw = { aria: 'Cours du 23 novembre de 8 heures 00 à 11 heures 00',
  lines: ['Diff des apprentissages', 'Leroy Anne', 'BA3 - S3 - EPS', '3.1.01'], cancelledMarker: false };
expect(parseCourse(raw, '2026-11-23')).toEqual({ date: '2026-11-23', start: '08:00', end: '11:00',
  subject: 'Diff des apprentissages', teacher: 'Leroy Anne', group: 'BA3 - S3 - EPS', room: '3.1.01', cancelled: false, extra: [] });
// passage d'année
expect(parseCourse({ ...raw, aria: 'Cours du 2 janvier de 13 heures 30 à 16 heures 30' }, '2026-12-28').date).toBe('2027-01-02');
expect(parseCourse({ ...raw, aria: 'Cours du 2 janvier de 13 heures 30 à 16 heures 30' }, '2026-12-28').start).toBe('13:30');
// enseignant absent : la ligne qui contient le groupe sert d'ancre
expect(parseCourse({ ...raw, lines: ['AFP 3', 'BA3 - S3 - EPS', '1.0.07'] }, '2026-11-23')).toMatchObject({ teacher: '', room: '1.0.07' });
expect(parseCourse({ ...raw, cancelledMarker: true }, '2026-11-23').cancelled).toBe(true);
```
  + un test par fichier de `tests/fixtures/` : chaque `RawCourse` se parse sans exception, `date` dans la semaine, `start < end`, `subject` non vide.
- [ ] **Step 3:** `npx vitest run tests/sync/parse.test.ts` → FAIL.
- [ ] **Step 4:** Implémenter `parseCourse` : regex sur l'aria (`/Cours du (\d+) (\S+) de (\d+) heures (\d+) à (\d+) heures (\d+)/`), table des mois en français, année = celle de `weekStart`, +1 si mois < mois de `weekStart`. Lignes : `subject = lines[0]` ; index du groupe = première ligne contenant ` - ` qui ressemble à un nom de promotion (au besoin passer la promo attendue en 3e paramètre optionnel) ; teacher = lignes entre sujet et groupe jointes par `, ` ; room = première ligne après le groupe ; reste → `extra`. Ajuster aux fixtures réelles.
- [ ] **Step 5:** Implémenter `scrapePromoList` et `scrapePromo` (réutilise le code du script de capture ; le script devient un appel à ces fonctions). Toute anomalie (popup non trouvé, promo absente de la liste, timeout 30 s) → `throw`.
- [ ] **Step 6:** `npx vitest run tests/sync/parse.test.ts` → PASS ; `npx tsx scripts/capture-fixtures.ts` tourne de bout en bout.
- [ ] **Step 7:** `git add -A && git commit -m "feat(sync): Hyperplanning capture, parser and scraper"`

---

### Task 3: Moteur de diff

**Files:**
- Create: `src/sync/diff.ts`
- Test: `tests/sync/diff.test.ts`

**Interfaces:**
- Consumes: `Course`, `Snapshot`, `Change`, `mondayOf` (Task 1)
- Produces:
```ts
export function courseKey(c: Course): string; // `${date}|${subject}|${group}`
export function diffSnapshots(prev: Snapshot, next: Snapshot, detectedAt: string): Change[];
```

Règles (spec « Détection des changements ») :
- Ne comparer que les cours dont `mondayOf(date)` ∈ `prev.weeks ∩ next.weeks`.
- Appariement par `courseKey` ; à clé égale, appariement par ordre de `start`.
- Apparié : `start`/`end` différent → `horaire` ; `room` → `local` ; `teacher` → `enseignant` ; `extra` → `autre` ; `cancelled` false→true → `annule` ; true→false → `ajoute`. Un `Change` par type concerné.
- Non apparié côté prev → `annule` (sauf s'il était déjà `cancelled`) ; côté next → `ajoute` (sauf s'il est `cancelled`).
- Puis : un `annule`-par-disparition et un `ajoute` de même `subject|group` dans la même semaine → fusion en un `deplace` (`before` = ancien, `after` = nouveau).
- `id` = `${kind}|${courseKey(after ?? before)}|${detectedAt}`.

- [ ] **Step 1: Tests qui échouent** — fabrique `c(overrides)` partant du cours `Diff des apprentissages` de Task 2 ; `snap(courses, weeks=['2026-11-23'])` :
  - `identical_snapshots_yield_no_change` → `[]`
  - `room_change_yields_local` : room `1.0.07`→`2.1.04` → 1 change `local`, before.room `1.0.07`, after.room `2.1.04`
  - `time_change_yields_horaire` : start `13:00`→`14:00`
  - `room_and_time_change_yield_two_changes` → kinds `['horaire','local']` (ordre trié)
  - `disappeared_course_yields_annule`
  - `cancelled_flag_yields_annule` (présent, `cancelled: true`)
  - `new_course_yields_ajoute`
  - `same_subject_twice_same_day_pairs_chronologically` : prev 08:00 et 14:00 ; next 08:00 et 15:00 → exactement 1 `horaire` (14:00→15:00)
  - `moved_to_other_day_same_week_yields_deplace` : mardi 13:00 → jeudi 10:00 → 1 `deplace`
  - `new_week_in_window_yields_nothing` : prev.weeks `['2026-11-23']`, next.weeks `['2026-11-23','2026-11-30']` avec 5 cours le 30/11 → `[]` (Review Focus 1)
  - `week_leaving_window_yields_nothing`
- [ ] **Step 2:** `npx vitest run tests/sync/diff.test.ts` → FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** `git commit -am "feat(sync): snapshot diff engine"` (ajouter les nouveaux fichiers).

---

### Task 4: Garde-fou lectures suspectes

**Files:**
- Create: `src/sync/guard.ts`
- Test: `tests/sync/guard.test.ts`

**Interfaces:**
- Consumes: `Snapshot` (Task 1)
- Produces:
```ts
export function isSuspicious(prev: Snapshot | null, next: Snapshot): boolean;
export function decidePublish(prev: Snapshot | null, pending: Snapshot | null, next: Snapshot):
  { publish: boolean; pending: Snapshot | null };
```

Règles : suspect si (sur les semaines communes) une semaine passe de ≥ 1 cours à 0, ou si le total passe sous 50 % de prev quand prev ≥ 4 cours. `prev === null` → jamais suspect. Non suspect → `{publish: true, pending: null}`. Suspect et `pending` a les mêmes cours que `next` (comparaison des `courses` triés, `fetchedAt` ignoré) → `{publish: true, pending: null}`. Sinon → `{publish: false, pending: next}`. (Un échec de lecture = exception dans `scrapePromo` : géré en Task 7, ni publication ni notification.)

- [ ] **Step 1: Tests qui échouent** : `first_snapshot_publishes`, `normal_change_publishes_immediately`, `week_emptied_is_held` (publish false, pending = next), `same_suspicious_read_twice_publishes` (Review Focus 2 : grève/congé confirmé), `different_suspicious_read_replaces_pending`, `drop_below_half_is_held` (prev 6 → next 2), `small_prev_not_suspicious` (prev 3 → next 1 publie).
- [ ] **Step 2:** → FAIL. **Step 3:** implémenter. **Step 4:** → PASS.
- [ ] **Step 5:** `git commit -m "feat(sync): suspicious-read guard"`

---

### Task 5: Textes de notification

**Files:**
- Create: `src/sync/notify-text.ts`
- Test: `tests/sync/notify-text.test.ts`

**Interfaces:**
- Consumes: `Change` (Task 1)
- Produces: `export function notificationFor(changes: Change[], now: Date): { title: string; body: string; url: string } | null;`

Règles : garder seulement les changements dont le cours (`after ?? before`) a `date+end` > `now` ; aucun → `null`. `url` toujours `'/#/changements'`. Jour relatif (heure de Bruxelles) : même date → `aujourd'hui`, lendemain → `demain`, sinon jour de la semaine en minuscule (`jeudi`). Copie exacte :

| kind | title | body |
|---|---|---|
| annule | `Cours annulé` | `Act. gymniques 5 · aujourd'hui 13:00 n'aura pas lieu.` |
| local | `Changement de local` | `AFP 3 · jeudi 10:00 → local 2.1.04 (au lieu de 1.0.07).` |
| horaire | `Horaire modifié` | `Physiologie 5 · mardi : 14:00–17:00 (au lieu de 13:00–17:00).` |
| ajoute | `Cours ajouté` | `Sports et jeux · jeudi 13:30–16:30 · Sport 6 TC.` |
| deplace | `Cours déplacé` | `Physiologie 5 · mardi 13:00 → jeudi 10:00.` |
| enseignant | `Enseignant modifié` | `AFP 3 · jeudi 10:00 · avec Dupont Marie (au lieu de Leroy Anne).` |
| autre | `Cours modifié` | `AFP 3 · jeudi 10:00 · détails mis à jour.` |
| ≥ 2 changements | `3 changements dans ton horaire` | sujets distincts séparés par `, `, 3 max puis `…` |

- [ ] **Step 1: Tests qui échouent** : une assertion `toEqual` par ligne du tableau (now = `2026-11-23T09:40:00+01:00`, cours aux dates lundi 23 / mardi 24 / jeudi 26), + `past_course_change_is_ignored` (→ `null`), + `grouped_three` → title `3 changements dans ton horaire`, body `Act. gymniques 5, AFP 3, Physiologie 5`.
- [ ] **Step 2:** → FAIL. **Step 3:** implémenter. **Step 4:** → PASS.
- [ ] **Step 5:** `git commit -m "feat(sync): notification copy"`

---

### Task 6: API Cloudflare Pages Functions + KV

**Files:**
- Create: `wrangler.toml` (binding KV `HORAIRE`, `pages_build_output_dir = "dist"`), `functions/api/[[route]].ts`
- Test: `tests/api/route.test.ts` (KV simulé par une `Map` derrière l'interface `KVNamespace` minimale `get/put/delete/list`)

**Interfaces:**
- Consumes: types (Task 1)
- Produces (HTTP, JSON) :

| Méthode | Chemin | Auth | Effet / réponse |
|---|---|---|---|
| GET | `/api/promos` | — | `string[]` (KV `promos`) |
| GET | `/api/schedule/:promo` | — | `{ snapshot: Snapshot, lastSuccess: string }` ; 404 si promo inconnue |
| GET | `/api/changes/:promo` | — | `Change[]` (KV `changes:<promo>`, 50 derniers, plus récent d'abord) |
| POST | `/api/subscribe` | — | body `{ promo, subscription: PushSub }` → KV `sub:<sha256(endpoint)>` = `{promo, subscription}` ; 204 |
| DELETE | `/api/subscribe` | — | body `{ endpoint }` → supprime ; 204 |
| GET | `/api/admin/subs` | Bearer | `{ hash, promo, subscription }[]` |
| DELETE | `/api/admin/subs/:hash` | Bearer | 204 |
| GET | `/api/admin/state/:promo` | Bearer | `{ snapshot: Snapshot \| null, pending: Snapshot \| null }` |
| PUT | `/api/admin/state/:promo` | Bearer | body `{ snapshot?, pending?, newChanges? }` → écrit seulement les clés fournies ; `newChanges` préfixés à `changes:<promo>` et tronqué à 50 |
| PUT | `/api/admin/promos` | Bearer | body `string[]` |
| PUT | `/api/admin/last-success` | Bearer | body `{ at }` → KV `meta:lastSuccess` |

Les noms de promotion contiennent des espaces : `:promo` est décodé avec `decodeURIComponent`. Validation (frontière de confiance) : `:promo` doit appartenir à `promos` (sinon 404) ; `subscription.endpoint` doit être `https://` et < 1 kB, `keys.p256dh`/`keys.auth` chaînes non vides (sinon 400) ; Bearer comparé à `env.ADMIN_TOKEN` (sinon 401). Corps > 1 Mo → 413.

- [ ] **Step 1: Tests qui échouent** : `promos_list`, `schedule_unknown_promo_404`, `subscribe_stores_and_dedups_same_endpoint`, `subscribe_rejects_http_endpoint_400`, `subscribe_rejects_unknown_promo_404`, `admin_requires_token_401`, `admin_state_put_prepends_changes_and_caps_50`, `admin_subs_lists_all`.
- [ ] **Step 2:** → FAIL. **Step 3:** implémenter (un `switch` sur méthode+chemin, `crypto.subtle.digest` pour le hash). **Step 4:** → PASS.
- [ ] **Step 5:** `npx wrangler pages dev dist --kv HORAIRE` démarre et `curl localhost:8788/api/promos` → `[]`.
- [ ] **Step 6:** `git commit -m "feat(api): Pages Functions API over KV"`

---

### Task 7: Orchestration, push et workflows GitHub

**Files:**
- Create: `src/sync/push.ts`, `src/sync/api-client.ts`, `src/sync/main.ts`, `.github/workflows/sync.yml`, `.github/workflows/keepalive.yml`
- Test: `tests/sync/push.test.ts`, `tests/sync/main.test.ts`

**Interfaces:**
- Consumes: `scrapePromo`, `scrapePromoList` (T2), `diffSnapshots` (T3), `decidePublish` (T4), `notificationFor` (T5), API admin (T6), `isInRunWindow`, `brusselsParts`, `mondayOf` (T1)
- Produces:
```ts
// push.ts — sender injectable pour les tests (défaut : webpush.sendNotification)
export async function sendAll(subs: { hash: string; subscription: PushSub }[], payload: object,
  sender?: (s: PushSub, body: string) => Promise<unknown>): Promise<{ sent: number; expired: string[] }>;
// api-client.ts — miroir des routes admin de Task 6 (promo encodée avec encodeURIComponent)
export type ApiClient = {
  getPromos(): Promise<string[]>; putPromos(p: string[]): Promise<void>;
  getState(promo: string): Promise<{ snapshot: Snapshot | null; pending: Snapshot | null }>;
  putState(promo: string, body: { snapshot?: Snapshot; pending?: Snapshot | null; newChanges?: Change[] }): Promise<void>;
  getSubs(): Promise<{ hash: string; promo: string; subscription: PushSub }[]>; deleteSub(hash: string): Promise<void>;
  putLastSuccess(at: string): Promise<void>;
};
export function createApiClient(base: string, token: string): ApiClient;
// main.ts
export async function runOnce(deps: { now: Date; api: ApiClient; scrape: (promo: string, weeks: string[]) => Promise<Course[]>;
  scrapeList: () => Promise<string[]>; push: typeof sendAll }): Promise<{ promos: number; changes: number; failed: string[] }>;
```

Déroulé de `runOnce` : hors fenêtre (`isInRunWindow`) → retour immédiat. Liste des promos si absente ou si première exécution du jour (heure Bruxelles 6 h, minute < 30). Promos actives = promos distinctes des abonnements. Semaines = lundi courant + 3. Pour chaque promo (séquentiel, une seule page Playwright) : scrape → si exception, ajouter à `failed`, continuer ; sinon `decidePublish` ; si publish : `diffSnapshots` (si prev), PUT state seulement si cours ou pending changés, `notificationFor` → `sendAll` aux abonnés de la promo ; abonnements `expired` → DELETE. Fin : PUT `last-success` si `failed` vide. Code de sortie ≠ 0 si `failed` non vide (GitHub envoie alors son e-mail d'échec au mainteneur).

- [ ] **Step 1: Tests qui échouent** :
  - `push.test.ts` : `expired_subscription_is_reported_not_thrown` — sender rejette `{statusCode: 410}` pour 1 sur 3 → `{ sent: 2, expired: ['h2'] }` (Review Focus 5) ; idem 404 ; une erreur 500 n'est pas `expired` et ne fait pas échouer les autres.
  - `main.test.ts` (fakes en mémoire) : `outside_window_does_nothing` ; `failed_scrape_publishes_nothing_and_reports` ; `first_run_stores_snapshot_without_notifying` ; `change_notifies_only_that_promos_subscribers` ; `no_change_writes_nothing` (aucun PUT state) ; `expired_subs_are_deleted`.
- [ ] **Step 2:** → FAIL. **Step 3:** implémenter (`api-client.ts` = `fetch` vers `API_BASE` + `Authorization: Bearer ADMIN_TOKEN`, entrée CLI dans `main.ts` qui lance chromium et appelle `runOnce`). **Step 4:** → PASS.
- [ ] **Step 5:** `sync.yml` : `on: schedule: - cron: '0,30 4-21 * * 1-6'` + `workflow_dispatch` ; `concurrency: sync` ; Node 20, `npm ci`, `npx playwright install --with-deps chromium`, `npx tsx src/sync/main.ts` avec les secrets en env. (La fenêtre UTC large couvre CET et CEST ; `isInRunWindow` filtre.)
- [ ] **Step 6:** `keepalive.yml` : cron mensuel `0 8 1 * *`, `permissions: contents: write`, écrit la date dans `.github/keepalive` et commit/push (évite la désactivation des cron après 60 jours).
- [ ] **Step 7:** `git commit -m "feat(sync): orchestrator, web push, GitHub workflows"`

---

### Task 8: PWA — coquille, service worker, premier lancement

**Files:**
- Create: `vite.config.ts`, `index.html`, `src/app/main.tsx`, `src/app/App.tsx`, `src/app/store.ts`, `src/app/push.ts`, `src/app/onboarding/{Install,Promo,Notifs}.tsx`, `src/app/styles.css`, `public/sw.js`, `public/manifest.webmanifest`, `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`
- Test: `tests/app/store.test.ts`, `tests/app/promo-search.test.ts`

**Interfaces:**
- Consumes: API publique (T6), `isStale` (T1)
- Produces:
```ts
// store.ts
export function getPromo(): string | null; export function setPromo(p: string): void;       // localStorage 'horaire.promo'
export function getClearedAt(): string | null; export function setClearedAt(v: string | null): void; // 'horaire.clearedAt'
export function getLastSeenAt(): string | null; export function setLastSeenAt(v: string): void;      // 'horaire.lastSeenAt'
export function isStandalone(): boolean; // matchMedia('(display-mode: standalone)') || navigator.standalone
export type OnboardingStep = 'install' | 'promo' | 'notifs' | 'done';
export function onboardingStep(o: { standalone: boolean; isIOS: boolean; promo: string | null; permission: NotificationPermission | 'unsupported'; skippedNotifs: boolean }): OnboardingStep;
export function searchPromos(all: string[], query: string): string[]; // normalise accents/casse/ponctuation, tous les mots doivent matcher
// push.ts
export async function subscribe(promo: string): Promise<'granted' | 'denied' | 'unsupported'>;
```

Écrans = maquette `design/Install.dc.html`, `design/Promo.dc.html`, `design/Notifs.dc.html` (copie identique, y compris « Étape 2 sur 3 », « C'est fait, continuer », « Plus tard »). `localStorage` lu/écrit dans des `try/catch` (valeur par défaut si indisponible). Le service worker : cache « network-first » de `/api/*` et « cache-first » des assets ; `push` → `showNotification(title, { body, data: { url }, icon })` ; `notificationclick` → focus/ouvre `url`. Clé VAPID publique injectée via `import.meta.env.VITE_VAPID_PUBLIC_KEY`. `subscribe` n'est appelé que depuis le clic sur « Activer les notifications » (exigence iOS).

- [ ] **Step 1: Tests qui échouent** :
  - `onboardingStep` : iOS non standalone → `install` ; non-iOS non standalone sans promo → `promo` ; standalone sans promo → `promo` ; promo + permission `default` → `notifs` ; promo + `granted` → `done` ; promo + `default` + skipped → `done` ; `unsupported` → `done`.
  - `searchPromos(list, 'ba3 eps')` → `['BA3 - S3 - EPS']` ; `'EPS'` contient les 4 promos EPS ; `'  '` → liste complète ; `'éps'` = `'eps'`.
- [ ] **Step 2:** → FAIL. **Step 3:** implémenter store + composants Preact (installer `vite preact @preact/preset-vite @testing-library/preact jsdom`). **Step 4:** → PASS.
- [ ] **Step 5:** `npm run build && npx wrangler pages dev dist` → ouvrir l'URL en largeur 390 px : les trois écrans ressemblent à la maquette ; le choix de promotion persiste après rechargement.
- [ ] **Step 6:** `git commit -m "feat(app): PWA shell, service worker, onboarding"`

---

### Task 9: Vues Jour, Semaine, Changements

**Files:**
- Create: `src/app/model.ts`, `src/app/views/{Day,Week,Changes,Settings}.tsx`, `src/app/components/{CourseCard,TabBar}.tsx`
- Test: `tests/app/model.test.ts`, `tests/app/changes-view.test.tsx`

**Interfaces:**
- Consumes: `Snapshot`, `Change`, `isStale` (T1), store (T8)
- Produces:
```ts
export type CourseStatus = 'passe' | 'en-cours' | 'a-venir' | 'annule';
export type DayItem = { kind: 'course'; course: Course; status: CourseStatus; progress: number /*0..1*/; changedKinds: ChangeKind[] }
                    | { kind: 'pause'; from: string; to: string };
export function dayModel(s: Snapshot, changes: Change[], date: string, now: Date):
  { items: DayItem[]; banner: Change | null; nextCourse: Course | null; changedDates: string[] };
export function weekModel(s: Snapshot, changes: Change[], monday: string, now: Date):
  { days: { date: string; label: string; items: DayItem[] }[]; emptyDays: string[] };
export function changesModel(changes: Change[], clearedAt: string | null, lastSeenAt: string | null):
  { visible: Change[]; unread: number };
```

Comportements (maquette `design/Main|Week|Changes.dc.html`) :
- Jour : défaut = aujourd'hui ; barre lun.–sam. avec pastille sur `changedDates` ; cours en cours = contour bleu + barre de progression + « Fin dans 1 h 20 » ; pause affichée si trou ≥ 30 min ; annulé = barré + étiquette « Annulé » ; bannière = changement le plus récent touchant ce jour (lien vers Changements) ; jour sans cours → « Pas de cours » + carte du prochain cours (`nextCourse`).
- Semaine : sections par jour, étiquettes « Annulé » / « Horaire » / « Local » / « Déplacé » / « Enseignant » ; jours vides regroupés en une ligne (« Vendredi 27 et samedi 28 · pas de cours ») ; flèches semaine précédente/suivante limitées à la fenêtre de l'instantané.
- Changements : fil filtré par `clearedAt` ; « Tout effacer » enregistre `clearedAt = now` et garde l'ancienne valeur pour « Annuler » ; écran vide « Tout est à jour » ; ouverture de l'onglet → `setLastSeenAt(now)` ; badge TabBar = `unread`.
- Réglages (bouton en haut de la vue Jour, non maquetté, simple liste) : « Changer de promotion » (rouvre l'écran Promo ; si abonnée, re-`POST /api/subscribe` avec la nouvelle promo), interrupteur notifications (off → `DELETE /api/subscribe` + `unsubscribe()`), lien « Ouvrir Hyperplanning ».
- Pied de page : « Mis à jour il y a N min » ; si `isStale` → bandeau « Horaire peut-être pas à jour — vérifie sur Hyperplanning » + lien.

- [ ] **Step 1: Tests qui échouent** (`model.test.ts`, données = cours de la maquette, now = lun. 23/11 09:40) :
  - `dayModel` : items = `[course en-cours progress≈0.556, pause 11:00–13:00, course annule]` ; `banner.kind === 'annule'` ; `changedDates` contient `'2026-11-26'` quand un `local` existe pour le 26.
  - `empty_day_has_next_course` : date `2026-11-29` (dimanche) → `items: []`, `nextCourse.date === '2026-11-30'` (ou premier cours suivant) (Review Focus 4).
  - `short_gap_is_not_a_pause` : trou de 15 min → pas d'item pause.
  - `weekModel` : `emptyDays` = `['2026-11-27','2026-11-28']`.
  - `changesModel` : `clearedAt` filtre les plus anciens ; `unread` compte ceux après `max(clearedAt, lastSeenAt)`.
  - `changes-view.test.tsx` : clic « Tout effacer » → texte « Tout est à jour » visible ; clic « Annuler » → les 3 changements réapparaissent.
- [ ] **Step 2:** → FAIL. **Step 3:** implémenter modèles puis vues (composants sans logique métier). **Step 4:** → PASS.
- [ ] **Step 5:** `npm run build && npx wrangler pages dev dist` avec KV rempli par un `snapshot` de fixture → comparer visuellement aux 3 artboards de la maquette en 390 × 844.
- [ ] **Step 6:** `git commit -m "feat(app): day, week and changes views"`

---

### Task 10: Mise en ligne et recette sur iPhone

Étapes nécessitant les comptes du mainteneur (GitHub + Cloudflare) : l'implémenteur prépare les commandes, le mainteneur les exécute ou les autorise.

- [ ] **Step 1:** Générer les clés VAPID : `npx web-push generate-vapid-keys`. Créer le KV : `npx wrangler kv namespace create HORAIRE` → reporter l'id dans `wrangler.toml`.
- [ ] **Step 2:** Créer le projet Pages relié au repo (build `npm run build`, sortie `dist`), secrets Pages : `ADMIN_TOKEN` (aléatoire 32 octets), variable `VITE_VAPID_PUBLIC_KEY`.
- [ ] **Step 3:** Repo GitHub **public** ; secrets Actions : `ADMIN_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` d'une adresse de contact choisie par le mainteneur), `API_BASE` (URL `*.pages.dev`).
- [ ] **Step 4:** Lancer `sync.yml` via `workflow_dispatch` → `GET /api/promos` renvoie ~100 promotions.
- [ ] **Step 5 (iPhone, iOS ≥ 16.4) :** ouvrir l'URL dans Safari → écran Installer ; ajouter à l'écran d'accueil ; ouvrir depuis l'icône → choisir `BA3 - S3 - EPS` → « Activer les notifications » → accepter. Relancer `sync.yml` : l'instantané apparaît dans Jour/Semaine.
- [ ] **Step 6:** Test de notification : `PUT /api/admin/state/BA3%20-%20S3%20-%20EPS` avec un `snapshot` où un cours futur a un autre local, puis relancer `sync.yml` → notification « Changement de local » reçue, le toucher ouvre Changements.
- [ ] **Step 7:** `git commit -am "chore: deployment config"` et partager le lien `*.pages.dev` à l'utilisatrice.
