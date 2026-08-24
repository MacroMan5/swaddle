# Swaddle — Design System

**Statut :** approuvé (source de vérité visuelle)
**Références :** ADR 0003 (Tailwind v4 + shadcn-svelte), design produit
(`docs/plans/2026-08-23-newborn-tracker-design.md`), spec NFR-005/006/008.
**Méthode :** direction générée puis arbitrée avec ui-ux-pro-max
(style « Soft UI Evolution », palette « Parenting & Baby Tracker » adaptée).

## Direction

Une app **calme, chaleureuse et lisible à 3 h du matin, d'un pouce**. Style
« soft UI » modéré : surfaces douces, coins arrondis généreux, ombres subtiles —
jamais de neumorphisme pur ni de glassmorphisme (contraste et perf). Le mode
sombre est un citoyen de première classe (usage nocturne), pas une inversion.

**Anti-patterns bannis :** emoji comme icônes, couleur seule porteuse de sens,
couleurs en dur dans les composants, blur décoratif, animations > 300 ms,
surfaces blanc pur en mode sombre, noir pur `#000` en fond.

## Tokens de couleur

Déclarés dans `@theme` (`src/app.css`). Les composants n'utilisent QUE ces
tokens (NFR-008).

### Sémantiques

| Token | Clair | Sombre | Usage |
|---|---|---|---|
| `--color-surface` | `#FAF9F7` | `#16151A` | fond de page (blanc cassé chaud / nuit sans noir pur) |
| `--color-surface-raised` | `#FFFFFF` | `#1F1E23` | cartes, panneaux |
| `--color-ink` | `#1C1B22` | `#F2F0EE` | texte principal (≥ 4,5:1) |
| `--color-ink-muted` | `#55525E` | `#A8A4A4` | texte secondaire (≥ 4,5:1 sur les fonds pastel) |
| `--color-ink-label` | `#444141` | `#CFCBC9` | libellés de tableau/ligne, onglets inactifs |
| `--color-border` | encre (`--ink`) | `#CFCBC9` | filets forts 2 px — de l'encre, pas un gris |
| `--color-border-hair` | encre à 22 % | encre à 20 % | filets fins 1 px entre lignes |
| `--color-primary` | `#DB2777` | `#F472B6` | identité, action principale (rose) |
| `--color-primary-text` | `#9D174D` | `#F9A8D4` | accent en taille de corps (AA sur surface) |
| `--color-primary-pressed` | `#BE185D` | `#EC4899` | état pressé de l'accent |
| `--color-on-primary` | `#FFFFFF` | `#2B0B1B` | texte sur primaire |
| `--color-accent` | `#0284C7` | `#38BDF8` | liens, éléments informatifs (bleu confiance) |
| `--color-danger` | `#DC2626` | `#F87171` | destructif, erreurs (toujours icône + texte) |

`--primary` seul est sous AA en taille de corps sur `--surface` (4,37:1) : tout
accent textuel ≤ 18 px passe par `--primary-text`.

### Catégories

Chaque catégorie a un trio 100/500/700 (fond pastel / décoratif / texte-icône).
La couleur renforce, l'icône + libellé portent le sens (`color-not-only`).
Les **500 sont décoratifs uniquement** (< 3:1 sur surface) : toute barre,
remplissage ou marqueur porteur d'information utilise le **700**.

| Catégorie | 100 (clair) | 500 | 700 | Sombre : fond / texte |
|---|---|---|---|---|
| Alimentation `feed` | `#FEF3C7` | `#F59E0B` | `#8A3F07` | `#3A2A12` / `#FBBF24` |
| Couche `diaper` | `#CCFBF1` | `#14B8A6` | `#0B5B55` | `#123230` / `#2DD4BF` |
| Sommeil `sleep` | `#E0E7FF` | `#6366F1` | `#3730A3` | `#232345` / `#818CF8` |

Icônes (lucide, trait 2 px, jamais de mélange filled/outline au même
niveau) — proposition à figer en T2/T3 : allaitement `heart`, biberon `milk`,
tirage `wind`, couche `droplets` (pipi) + `circle-dot` (caca), sommeil `moon`.

## Typographie

Auto-hébergée via `@fontsource` (NFR-006 : aucun CDN, y compris Google Fonts).

- **Une seule famille : Archivo** (400/500/600/700/800), sur toute l'app.
  Plus de serif — `--font-serif` est retiré, aucun `h1`–`h3` n'en hérite.
- **Minuteurs et données chiffrées** : `font-variant-numeric: tabular-nums` —
  obligatoire sur tout chiffre qui change (minuteurs, totaux) pour éviter le
  tremblement de mise en page.
- Échelle en tokens `--text-*` (`src/app.css`), un rôle = un token :

| Rôle (utilitaire) | Taille / graisse | Détail |
|---|---|---|
| `text-screen-title` | 20 px / 800 | `letter-spacing: -0.01em` |
| `text-onboarding-title` | 34 px / 800 | `line-height: 1.1` |
| `text-stat` | 26 px / 700 | tabular, chiffre de bande d'état |
| `text-timer` | 56 px / 800 | tabular, minuteur en cours |
| `text-section` | 10 px / 700 | MAJUSCULES, `ls .14em`, `--ink-muted` |
| `text-category` | 9.5 px / 700 | MAJUSCULES, `ls .13em`, couleur 700 de catégorie |
| `text-status` | 10 px / 700 | MAJUSCULES, `ls .16em`, ligne d'état du bandeau |
| `text-brand` | 13 px / 800 | MAJUSCULES, `ls .2em`, mot-symbole |
| `text-tile` / `text-tile-hint` | 16 px / 800 · 11 px / 600 | tuiles de saisie rapide |
| `text-value` / `text-label` | 15 px / 700 · 14 px / 600 | lignes libellé/valeur (`--ink-label`) |
| `text-row` / `text-row-time` | 14 px / 600 · 14 px / 700 | lignes d'événement (heure tabular) |
| `text-delta` | 20 px / 800 | deltas signés de la semaine |
| `text-sheet-title` / `text-amount` | 22 px / 800 · 32 px / 800 | feuilles (titre, volume) |
| `text-field` / `text-field-lg` | 17 px / 700 · 18 px / 700 | valeurs de champ (≥ 16 px : pas de zoom iOS) |
| `text-nav` | 11 px / 600–700 | MAJUSCULES, `ls .06em`, onglets |
| `text-body` | 14 px / 400 | corps, `line-height: 1.5` (taille du `body`) |

Les champs de saisie restent ≥ 16 px (zoom iOS) même si le corps est à 14 px.

## Forme, profondeur, espacement

- Rayons : un seul — `--radius-card: 6px` et `--radius-control: 6px`.
  Les pastilles rondes deviennent des barres/carrés (la catégorie est un filet
  et un libellé, pas une bulle).
- Ombres : **trois niveaux** appliqués pour de vrai — `--shadow-sm` (tuiles),
  `--shadow-md` (éléments flottants : toasts), `--shadow-lg` (feuilles,
  dialogues) ; en sombre, l'élévation passe surtout par la teinte de surface.
- Filets : la hiérarchie est portée par les traits — 2 px `--border` (encre)
  pour les séparations fortes et les cadres, 1 px `--border-hair` entre les
  lignes d'un même bloc.
- Espacement : rythme 4/8 px (Tailwind standard) ; gouttière d'écran 16 px,
  gap entre tuiles 10 px, tuile 128 px, onglet de nav 64 px, contrôles 52–58 px.
- Cibles tactiles ≥ 48 px, espacées ≥ 8 px ; `min-h-dvh` (jamais `100vh`) ;
  la barre de navigation basse réserve `env(safe-area-inset-bottom)`.

## Mouvement

Quatre mouvements, tous derrière `prefers-reduced-motion` :

- **Entrée des blocs** : `translateY(14px)` + fondu, 450 ms `ease-out`,
  décalage 60 ms par bloc (`.enter` + `--enter-delay`), au premier montage
  de l'écran seulement — jamais rejoué sur une mise à jour SSE.
- **Pouls du minuteur** : carré d'état du bandeau, opacité 1 → 0,35 +
  `scale(0.82)`, 1,6 s en boucle (`--animate-pulse-dot`).
- **Barres de semaine** : `scaleY(0 → 1)`, `transform-origin: bottom`,
  500 ms, décalage 40 ms par jour (`--animate-grow-y`).
- **Appui** : `translateY(2px)` + suppression d'ombre (plus lisible que le
  `scale(0.97)` précédent sur des éléments à angles vifs).
- Panneaux inférieurs (sheets) : glissement depuis le bas 200 ms ; jamais de
  navigation bloquée par une animation. Aucune animation décorative de plus.

## Règles par écran (contrats pour les tranches)

### Navigation (T4)
- Barre basse fixe, 3 destinations (Aujourd'hui, Historique, Réglages),
  icône + libellé, état actif marqué par couleur ET indicateur.
- Un seul CTA principal par écran.

### Aujourd'hui (T2–T4)
- Cartes par catégorie teintées `*-100` (clair) / fond sombre dédié, icône
  `*-700`, temps écoulé en `tabular-nums`.
- Boutons de saisie rapide dans la carte (Pipi/Caca/Les deux ; Allaiter…),
  ≥ 48 px, feedback pressé immédiat.
- Toast « Annuler » : `aria-live="polite"`, 5 s, ne vole pas le focus.
- État vide accueillant à la première ouverture (« Aucune activité — tout
  commence ici »), jamais un écran blanc.

### Formulaires (T2–T3, panneaux inférieurs)
- Libellés visibles (jamais placeholder seul), erreurs sous le champ avec
  cause + correction, validation au blur, `inputmode="decimal"` pour les
  volumes, boutons désactivés pendant l'envoi avec spinner.
- Fermeture du panneau : affordance visible + glisser vers le bas ;
  confirmation si saisie non enregistrée.

### Historique (T4)
- **Grille horaire (vue jour)** — 20 px par heure, soit 480 px pour les 24 h :
  la journée entière tient dans un écran, **sans scroll interne**. C'est la
  raison d'être de la vue — lire la *forme* d'une journée (la nuit, les creux
  entre les tétées, la longue sieste) d'un coup d'œil. Le détail appartient
  à la liste chronologique juste en dessous.
- Le compromis est assumé : à cette densité une tétée de 20 min fait 7 px et
  ne peut pas porter de texte. Une échelle assez généreuse pour étiqueter
  chaque bloc (96 px/h) rend la journée haute de 2300 px : on lit chaque
  événement mais on ne voit plus la journée.
- Deux traitements selon la hauteur : au-dessus de 26 px, teinte claire `*-100`,
  contour fermé + bord gauche de 4 px, heure et libellé à l'intérieur ; en
  dessous, **barre saturée `*-500` arrondie**, car un filet de 5 px en teinte
  claire se lit comme une règle horizontale, pas comme un événement.
- Axe de 32 px à gauche, libellé une heure sur deux (étiqueter chaque heure
  empilerait les nombres), filets pleins aux heures paires et `border-border/40`
  aux heures impaires.
- Plancher de 5 px : il ne mord qu'en deçà de 15 min, et de quelques pixels.
  Le packing raisonne sur la hauteur **dessinée**, jamais sur la durée brute,
  sinon un bloc élevé au plancher passerait sous son voisin.
- Chevauchements résolus en colonnes de largeur `100 % / n` (jamais en px
  fixes) : une tétée pendant une sieste donne deux demi-blocs, aucun caché.
- Événements ponctuels (biberon, couche) sur un rail de 20 px à droite,
  **distingués par la forme autant que par la teinte** (biberon = disque,
  couche = losange) : ils sont trop petits pour une icône, et la catégorie ne
  doit pas reposer sur la seule couleur (NFR-005).
- Minuteur en cours : borné à l'heure courante, contour en `border-dashed`
  quand le bloc est assez haut pour en porter un. Ligne « maintenant » en
  `--color-primary`.
- Grille et liste chronologique coexistent, chacune précédée d'un titre
  `sr-only` : aucune des deux n'est `aria-hidden` (la grille contient des
  boutons focusables), un lecteur d'écran saute l'une par les titres. La liste
  reste le chemin fiable pour atteindre un événement court au doigt.
- Liste chronologique : heure de début et heure de fin **empilées** dans une
  colonne de 56 px (`…` pour un minuteur en cours, rien pour un événement
  ponctuel). Une plage sur une seule ligne mangerait un tiers de la largeur à
  375 px ; le nom accessible de la ligne épelle la plage pour lever
  l'ambiguïté de deux heures nues.
- Timeline colorée par catégorie avec motif/icône en plus de la couleur.
- Squelettes (pas de spinner bloquant) au chargement > 300 ms.
- Barres/graphes hebdo : étiquettes directes, pas de légende détachée,
  grilles discrètes, résumé textuel accessible.

### Mode sombre (transversal)
- Testé indépendamment du clair à chaque livraison (contraste AA re-vérifié).
- Pas de blanc pur ; catégories désaturées selon le tableau ci-dessus.
- Le thème suit Réglages (clair/sombre/auto), classe sur `<html>`, sans flash.

## Checklist de livraison UI (chaque PR frontend)

- [ ] Aucune couleur/rayon/ombre en dur — tokens uniquement.
- [ ] Contraste AA vérifié en clair ET en sombre.
- [ ] Cibles ≥ 48 px, focus visible, navigation clavier.
- [ ] `tabular-nums` sur les chiffres dynamiques.
- [ ] `prefers-reduced-motion` respecté.
- [ ] Testé à 320, 390, 768 px + mode sombre (AC-011).
- [ ] Icônes lucide uniquement, un seul style de trait.
