# Thème sombre Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** l'app suit le thème clair/sombre de l'iPhone, avec un choix forcé Clair/Sombre dans Réglages.

**Architecture:** une palette Graphite dans `src/app/styles.css`, activée par `prefers-color-scheme: dark` ou par `data-theme` sur `<html>`. `public/theme.js` pose `data-theme` avant l'affichage ; `src/app/theme.ts` lit, enregistre et applique le choix.

**Tech Stack:** Preact, TypeScript, CSS variables, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-23-theme-sombre-design.md`

## Global Constraints

- Clé `horaire.theme`, valeurs `clair` | `sombre` ; absente = Auto.
- `data-theme` sur `document.documentElement` : `clair` | `sombre` | absent.
- `theme-color` : `#F5F4F0` en clair, `#121316` en sombre.
- Manifeste : `background_color` `#121316`.
- Palette Graphite exacte : voir la spec, section Décisions.
- Pas de script inline (CSP `script-src 'self'`).
- Textes de l'UI en français, tutoiement.

## Review Focus

- `localStorage` qui lève (navigation privée) : Auto, sans erreur (`theme.js` et `theme.ts`).
- Valeur inconnue dans `horaire.theme` : traitée comme Auto.
- Retour à Auto après un choix forcé : l'attribut est retiré et les deux `theme-color` reprennent leurs couleurs par défaut.

---

### Task 1: Choix du thème (stockage, application, démarrage)

**Files:**
- Create: `src/app/theme.ts`, `public/theme.js`
- Modify: `index.html`, `public/manifest.webmanifest`
- Test: `tests/app/theme.test.ts`

**Interfaces:**
- Produces: `type Theme = 'auto' | 'clair' | 'sombre'` ; `getTheme(): Theme` ; `setTheme(t: Theme): void` (enregistre, puis applique : `data-theme` posé ou retiré, et `content` des `<meta name="theme-color">` réécrit : forcé → les deux à la couleur du thème ; Auto → celle avec `media` dark à `#121316`, l'autre à `#F5F4F0`).

- [ ] **Step 1: Tests** `get_defaults_to_auto`, `get_ignores_unknown_value` (`'bleu'` → `'auto'`), `set_sombre_sets_attribute_and_metas`, `set_auto_removes_attribute_and_restores_metas`, `storage_throwing_falls_back_to_auto`.
- [ ] **Step 2:** lancer, vérifier l'échec.
- [ ] **Step 3:** écrire `theme.ts` (helpers `read`/`write` de `store.ts`, à exporter). `public/theme.js` : IIFE dans un `try` qui lit la clé et, si `clair` ou `sombre`, pose l'attribut et les metas. `index.html` : `<script src="/theme.js"></script>` avant tout, et deux metas `theme-color` avec `media="(prefers-color-scheme: light)"` et `(prefers-color-scheme: dark)`. Manifeste : `background_color`.
- [ ] **Step 4:** tests verts.

### Task 2: Palette sombre

**Files:**
- Modify: `src/app/styles.css`, `src/app/onboarding/Install.tsx`, `src/app/onboarding/Notifs.tsx`, `src/app/onboarding/Promo.tsx`

- [ ] **Step 1:** nouvelles variables `--accent-fill` (fond bleu sous texte blanc ; clair = `--accent`), `--on-ink` (texte du jour sélectionné ; clair = `#FFFFFF`), `--badge` (pastille ; `#B4500B` dans les deux thèmes). Les remplacer aux usages : `.btn-primary`, `.app-tile`, `.promo-row[aria-pressed]`, notification d'exemple, `.pill-now`, `.switch.is-on`, `.tab-badge`, `.daybar button.is-selected`.
- [ ] **Step 2:** bloc Graphite écrit une seule fois dans `:root[data-theme='sombre']` et répété dans `@media (prefers-color-scheme: dark) { :root:not([data-theme='clair']) { … } }`. `color-scheme: light dark` sur `:root`, forcé selon `data-theme`. Ombres en sombre : `rgba(0, 0, 0, 0.3)`.
- [ ] **Step 3:** traits SVG des écrans d'accueil en `currentColor` (le parent porte `color: var(--accent)` ou `var(--muted)`).
- [ ] **Step 4:** `npm test` et `npm run typecheck` verts.

### Task 3: Réglages · Apparence

**Files:**
- Modify: `src/app/views/Settings.tsx`, `src/app/styles.css`
- Test: `tests/app/settings-theme.test.tsx`

**Interfaces:**
- Consumes: `getTheme`, `setTheme`, `Theme` (Task 1).

- [ ] **Step 1: Tests** `shows_auto_pressed_by_default`, `click_sombre_saves_and_applies` (la clé vaut `sombre`, `data-theme` vaut `sombre`, bouton Sombre `aria-pressed="true"`), `click_auto_clears` (clé absente).
- [ ] **Step 2:** échec vérifié.
- [ ] **Step 3:** sous la liste : `<h2 class="settings-group">Apparence</h2>`, puis `<div class="segmented" role="group" aria-label="Thème">` avec trois boutons Auto / Clair / Sombre (`aria-pressed`), puis une phrase d'aide : Auto « Suit le réglage de l'iPhone. », Clair « Toujours clair, même quand l'iPhone est en mode sombre. », Sombre « Toujours sombre, même quand l'iPhone est en mode clair. ».
- [ ] **Step 4:** tests et typecheck verts ; captures des écrans Jour, Semaine, Changements et Réglages en sombre, comparées à la maquette Graphite.
- [ ] **Step 5:** commit, push, vérifier le déploiement Pages.
