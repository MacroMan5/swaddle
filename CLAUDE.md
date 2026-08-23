# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet

Prototype auto-hébergé (self-host) d'un clone de **Huckleberry** : application de suivi
d'un nouveau-né (tétées/biberons, sommeil, couches, croissance, etc.). Usage privé,
une seule famille, réseau local.

**État actuel : design et stack décidés, code pas encore écrit.** Le périmètre MVP
est dans `docs/plans/2026-08-23-newborn-tracker-design.md` ; la stack et le
déploiement sont fixés par les ADR 0001–0003 (SvelteKit + SQLite + SSE, image
GHCR multi-arch déployée par Docker Compose sur un Raspberry Pi 4, Tailwind v4 +
shadcn-svelte avec design tokens). Ne pas dévier sans nouvel ADR.

## Contraintes structurantes (déjà décidées)

- **Self-host** : le service doit tourner localement (machine ou serveur domestique),
  sans dépendance à un cloud tiers pour fonctionner.
- **Base de données simple et locale** : un fichier ou un service local léger
  (type SQLite ou équivalent) — pas de base managée externe. Le choix exact reste ouvert.
- **Service web** : accessible via navigateur; le détail (SPA, SSR, PWA…) reste ouvert.
- Prototype : privilégier la simplicité sur la généricité.

## Décisions à venir

Toute décision structurante (stack, schéma de données, fonctionnalités) doit être
consignée dans `docs/adr/` (un fichier Markdown par décision, préfixé d'un
numéro : `0001-stack.md`, … — gabarit dans `0000-template.md`). Avant d'implémenter
quoi que ce soit, vérifier si une décision existe; sinon, la proposer à
l'utilisateur d'abord.

## Commandes

Aucune pour l'instant — il n'y a pas encore de code. Quand la stack sera choisie,
documenter ici : installation, lancement en dev, build, tests (y compris comment
lancer un test unique), lint.

## Architecture

À documenter quand le code existera. Mettre à jour ce fichier au fil des décisions
plutôt que de le laisser dériver.

## Agent skills

### Issue tracker

Issues suivies dans GitHub Issues via le CLI `gh` (remote pas encore créé — à pousser
sur GitHub) ; les PRs externes ne sont pas une surface de triage. See `docs/agents/issue-tracker.md`.

### Triage labels

Vocabulaire canonique par défaut (needs-triage, needs-info, ready-for-agent,
ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context : `CONTEXT.md` à la racine + `docs/adr/`. See `docs/agents/domain.md`.
