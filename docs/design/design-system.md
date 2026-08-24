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
| `--color-surface` | `#FAF9F7` | `#15151A` | fond de page (blanc cassé chaud / nuit sans noir pur) |
| `--color-surface-raised` | `#FFFFFF` | `#1E1E25` | cartes, panneaux |
| `--color-ink` | `#1C1B22` | `#E9E7EE` | texte principal (≥ 4,5:1) |
| `--color-ink-muted` | `#67646F` | `#9C99A6` | texte secondaire (≥ 4,5:1 sur les fonds de cartes) |
| `--color-border` | `#EBE8E4` | `#2C2C35` | séparateurs visibles dans les deux thèmes |
| `--color-primary` | `#DB2777` | `#F472B6` | identité, action principale (rose) |
| `--color-on-primary` | `#FFFFFF` | `#2B0B1B` | texte sur primaire |
| `--color-accent` | `#0284C7` | `#38BDF8` | liens, éléments informatifs (bleu confiance) |
| `--color-danger` | `#DC2626` | `#F87171` | destructif, erreurs (toujours icône + texte) |

### Catégories

Chaque catégorie a un trio 100/500/700 (fond doux / accent / texte-icône).
La couleur renforce, l'icône + libellé portent le sens (`color-not-only`).

| Catégorie | 100 (clair) | 500 | 700 | Sombre : fond / texte |
|---|---|---|---|---|
| Alimentation `feed` | `#FEF3C7` | `#F59E0B` | `#B45309` | `#3A2A12` / `#FBBF24` |
| Couche `diaper` | `#CCFBF1` | `#14B8A6` | `#0F766E` | `#123230` / `#2DD4BF` |
| Sommeil `sleep` | `#E0E7FF` | `#6366F1` | `#4338CA` | `#232345` / `#818CF8` |

Icônes (lucide, trait 2 px, jamais de mélange filled/outline au même
niveau) — proposition à figer en T2/T3 : allaitement `heart`, biberon `milk`,
tirage `wind`, couche `droplets` (pipi) + `circle-dot` (caca), sommeil `moon`.

## Typographie

Auto-hébergée via `@fontsource` (NFR-006 : aucun CDN, y compris Google Fonts).

- **Titres** : Lora (serif chaleureux, 600–700).
- **Corps et UI** : Nunito Sans (rond, amical, 400/600 ; ≥ 16 px en mobile).
- **Minuteurs et données chiffrées** : Nunito Sans avec
  `font-variant-numeric: tabular-nums` — obligatoire sur tout chiffre qui
  change (minuteurs, totaux) pour éviter le tremblement de mise en page.
- Échelle : 14 / 16 / 18 / 22 / 28 ; interligne 1,5 pour le corps.

## Forme, profondeur, espacement

- Rayons : `--radius-card: 1rem` (cartes), `--radius-control: 0.75rem`
  (boutons, champs), plein pour les pastilles.
- Ombres : deux niveaux max — `--shadow-card: 0 1px 3px rgb(0 0 0 / 0.06),
  0 4px 12px rgb(0 0 0 / 0.05)` et un niveau modal ; en sombre, l'élévation
  passe par la teinte de surface, pas par l'ombre.
- Espacement : rythme 4/8 px (Tailwind standard), sections 16/24/32.
- Cibles tactiles ≥ 48 px, espacées ≥ 8 px ; `min-h-dvh` (jamais `100vh`) ;
  la barre de navigation basse réserve `env(safe-area-inset-bottom)`.

## Mouvement

- Micro-interactions 150–250 ms, `ease-out` en entrée, sorties ~150 ms.
- Feedback de pression < 100 ms : `active:scale-[0.97]` sur cartes et boutons.
- Panneaux inférieurs (sheets) : glissement depuis le bas 250 ms ; jamais de
  navigation bloquée par une animation.
- `prefers-reduced-motion` : tout est désactivable, les minuteurs restent
  des mises à jour de texte sans animation.
- Une à deux animations max par écran ; aucune animation décorative.

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
