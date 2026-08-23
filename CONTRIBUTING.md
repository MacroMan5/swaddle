# Contribuer

Merci de vouloir aider ! Ce projet est petit et familial — les règles le sont
aussi.

## Principes

- **Simplicité d'abord** : c'est un prototype pour une famille sur son LAN.
  Pas d'abstraction spéculative, pas de dépendance lourde, pas de cloud.
- **Les décisions structurantes vivent dans `docs/adr/`** : avant de proposer
  un changement d'architecture, de schéma ou de stack, ouvrez une issue pour
  en discuter ; la décision finit dans un ADR numéroté (gabarit :
  `docs/adr/0000-template.md`).
- **Le design fait foi** : le périmètre MVP et les parcours sont décrits dans
  `docs/plans/2026-08-23-newborn-tracker-design.md`, y compris la liste
  explicite du hors-périmètre.
- **Design tokens uniquement** : aucune couleur, ombre ou rayon en dur dans
  les composants — tout passe par les tokens Tailwind (ADR 0003).

## Workflow

1. Ouvrez une issue (bug ou proposition) avant tout gros changement.
2. Forkez, créez une branche depuis `main`.
3. Les tests accompagnent le code (unitaires pour les calculs de durées et
   totaux, intégration pour les minuteurs et la synchro — voir la section
   Vérification du design).
4. Ouvrez une PR avec une description courte : quoi, pourquoi.

## Langue

L'interface et la documentation produit sont en français. Le code (noms,
commits) est en anglais ; les issues et PRs sont bienvenues dans les deux
langues.

## Vie privée

Aucune télémétrie, aucun appel tiers, jamais. Les fichiers de données
(`data/`, `.env`) ne sont jamais versionnés.
