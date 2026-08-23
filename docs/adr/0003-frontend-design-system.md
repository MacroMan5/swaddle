# 0003 — Frontend et système de design

- **Date** : 2026-08-23
- **Statut** : acceptée

## Contexte

Le design (docs/plans/2026-08-23-newborn-tracker-design.md) exige une
interface mobile soignée et professionnelle : cartes par catégorie, panneaux
inférieurs, mode sombre nocturne, cibles tactiles de 48 px. La question s'est
posée de remplacer SvelteKit (ADR 0001) par React ou Vue pour profiter d'un
écosystème de composants plus riche (shadcn/ui).

## Décision

Conserver SvelteKit (Svelte 5) comme décidé dans l'ADR 0001, et bâtir le
design system avec Tailwind CSS v4 — les design tokens (couleurs sémantiques,
espacement, rayons, typographie) vivent en CSS dans un bloc `@theme` — et les
composants shadcn-svelte (port officiel de shadcn/ui sur bits-ui), avec les
icônes lucide-svelte. Le mode sombre est piloté par classe sur `<html>` avec
des tokens sémantiques redéfinis, jamais des couleurs en dur.

## Conséquences

- Pas de renégociation de l'architecture monolithe + SSE + adaptateur Node de
  l'ADR 0001 ; React aurait imposé Next.js (lourd pour un Pi) ou un split
  Vite + serveur séparé.
- shadcn-svelte copie les composants dans le dépôt : ils sont stylables via
  les tokens et ne créent pas de dépendance runtime à une librairie UI.
- Bundle client nettement plus léger qu'un équivalent React — pertinent pour
  des téléphones sur le Wi-Fi local servis par un Pi.
- Les tokens sont la seule source de vérité visuelle : toute couleur, ombre ou
  rayon utilisé dans un composant doit référencer un token.
- L'écosystème Svelte reste plus petit que celui de React ; les composants
  manquants seront écrits sur bits-ui en suivant les mêmes tokens.
