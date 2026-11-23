# Thème sombre — conception courte

Validée le 2026-11-23. Maquette : écrans « Sombre 1 · Graphite chaud » et « Réglages · Apparence » du canvas de design.

## Intention

L'app suit le thème de l'iPhone (clair ou sombre) par défaut. Dans Réglages, l'utilisateur peut forcer Clair ou Sombre.

- **Objectif** : un vrai design sombre (palette Graphite chaud), pas une inversion des couleurs.
- **Hors périmètre** : d'autres palettes, un réglage par écran.
- **À éviter** : un flash clair au démarrage quand le thème est sombre ; un texte qui passe sous 4.5:1 de contraste.

## Approches

1. **Variables CSS existantes + attribut `data-theme` posé avant l'affichage** (retenue). Les couleurs sont déjà des variables dans `src/app/styles.css` : on ajoute une deuxième palette, sans dupliquer de règles.
2. Bascule entièrement en JavaScript après le chargement de l'app : écartée, elle fait un flash clair au démarrage.
3. Deuxième feuille de style complète : écartée, elle double le travail à chaque changement de style.

## Décisions

- **Palette Graphite** : fond `#121316`, surfaces `#1C1D21`, texte `#F2F1ED`, texte secondaire `#A4A7B0`, texte désactivé `#8A8D96`, bleu (texte, liens) `#8CA2FF`, bleu plein (fond sous texte blanc) `#3553E0`, bleu doux `#232B4A`, annulé `#FF9C92` sur `#3A1F1D`, modifié `#FFB67D` sur `#3A2918`, point de changement `#F08A3C`, pastille de compteur `#B4500B`, lignes `#2E3036` et `#28292E`. Tous les textes testés à 4.5:1 ou plus.
- **Bascule** : thème sombre si `data-theme="sombre"` sur `<html>`, ou si l'iPhone est en sombre (`prefers-color-scheme: dark`) sans `data-theme="clair"`.
- **Choix enregistré** : clé `horaire.theme`, valeur `clair` ou `sombre`. Sans valeur, l'app suit l'iPhone (« Auto »).
- **Démarrage sans flash** : `public/theme.js`, chargé de façon bloquante en tête de `index.html`, lit la clé et pose `data-theme`. La CSP (`script-src 'self'`) autorise ce fichier.
- **Barre d'état** : deux `<meta name="theme-color">`, une par thème système (attribut `media`). Un choix forcé les réécrit avec la couleur du thème choisi.
- **Écran de lancement** : `background_color` du manifeste en `#121316` (choix de l'utilisateur : splash sombre pour tout le monde, le manifeste n'accepte qu'une couleur).
- **Réglages** : nouveau bloc « Apparence » sous la liste, sélecteur à trois boutons Auto / Clair / Sombre (`aria-pressed`), avec une phrase d'aide sous le sélecteur.
- **Couleurs en dur** : les blancs des surfaces et les traits des icônes d'accueil passent en variables. Le texte blanc sur fond bleu plein reste blanc.

## Laissé au constructeur

- Les ombres en sombre (atténuées ou retirées).
- Vérifier sur iPhone si la barre d'état en mode installé suit `theme-color`.
