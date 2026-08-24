# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet

**Swaddle** : application auto-hébergée (self-host) de suivi d'un nouveau-né
(tétées/biberons, sommeil, couches, etc.), inspirée des conventions UX d'apps
comme Huckleberry sans en reprendre le nom ni la marque. Usage privé, une seule
famille, réseau local. Dépôt public : github.com/MacroMan5/swaddle.

**État actuel : fondations en place** (squelette SvelteKit, tokens, SQLite,
santé, Docker, CI) ; les fonctionnalités arrivent par slices orchestrées via la
carte wayfinder (issue #7). Le périmètre MVP
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

- `npm ci --ignore-scripts` — installation (toujours avec `--ignore-scripts` :
  better-sqlite3 embarque ses prebuilds N-API ; sans le flag, `npm ci` tente un
  `node-gyp rebuild` inutile qui exige un toolchain C++).
- `npm run dev` — serveur de développement.
- `npm run check` — svelte-check (types + diagnostics).
- `npm run test:unit` — tests unitaires Vitest ; un seul fichier :
  `npx vitest run src/lib/server/db/db.test.ts`.
- `npm run test:e2e` — e2e Playwright (fait un build de prod ; nécessite
  `npx playwright install chromium` une première fois).
- `npm run build` — build de production (adapter-node → `build/`).
- `docker build -t swaddle .` — image de production (`node:22-slim`, jamais Alpine).

## Architecture

Monolithe SvelteKit 2 (Svelte 5, adapter-node) servant UI et API (ADR 0001) :

- `src/lib/server/db/` — couche SQLite : `openDb`/`getDb` (WAL, `foreign_keys ON`),
  migrations embarquées versionnées par `user_version` dans `migrations.ts`.
  Schéma v1 : `household`, `baby`, `caregiver`, `event` (JSON `details` par type).
- `src/lib/server/events/` — domaine des événements : `types.ts` (zod, FR-017),
  `repo.ts` (CRUD, soft delete, minuteurs uniques FR-013), `broadcast.ts`
  (fan-out SSE). Routes : `/api/babies`, `/api/events[...]`, `/api/timers[...]`,
  `/api/stream` (SSE) — contrat détaillé dans `docs/api/events-api.md`.
- `src/lib/server/setup.ts` — `isSetupComplete` (bébé + aidant existent).
- `src/routes/api/health/` — `GET /api/health` → `{ status, setupComplete }`.
- `src/lib/server/settings/` — domaine des réglages (slice 5) : `repo.ts`
  (foyer/bébé/aidants), `auth.ts` (hash PIN scrypt, session HMAC),
  `transfer.ts` (export JSON/CSV, restauration transactionnelle, instantané
  SQLite via `VACUUM INTO`), `gate.ts` (décision pure des portes). Routes :
  `/api/babies` (POST), `/api/caregivers[...]`, `/api/household[...]`,
  `/api/auth/pin`, `/api/export/json|csv`, `/api/backup`, `/api/restore` —
  contrat détaillé dans `docs/api/settings-api.md`.
- `src/hooks.server.ts` — porte configuration incomplète → `/setup` et porte
  code PIN → `/pin` (pages) / `401 pin_required` (API), à partir de
  `gateDecision`. Pages : `/setup` (assistant premier lancement), `/pin`
  (déverrouillage), `/settings` (réglages complets, FR-011).
- `src/app.css` — design tokens Tailwind v4 (`@theme`) + variables shadcn
  re-mappées ; mode sombre par classe `.dark` sur `<html>`. Toute couleur/rayon
  passe par un token (NFR-008) ; cibles tactiles ≥ 48 px, texte ≥ 16 px.
- `src/lib/components/ui/` — composants shadcn-svelte (ajouts via
  `npx shadcn-svelte@latest add <composant> -y`).
- `src/lib/client/` — couche client partagée par « Aujourd'hui » et
  « Historique » : `api.ts` (fetch typé vers `docs/api/events-api.md`,
  `ApiError`, `listEvents(babyId, from, to, overlap?)` pour l'historique),
  `format.ts` (`formatElapsed`/`formatClock`/`nursingDurationMs`/
  `todayRangeIso`), `summaries.ts` (moteur pur de résumés — FR-010, AC-006 :
  `dailySummary`/`weeklySummary`/`splitDurationByLocalDay` répartissent les
  événements à cheval sur minuit par jour local, testé DST dans les deux sens ;
  seule source de vérité, consommé par `SummaryCard` et par `/history`),
  `sync.svelte.ts` (`SyncStore`, classe à runes qui possède la connexion SSE,
  les événements du jour, les minuteurs actifs, l'offset serveur — RISK-001 —
  et `subscribeChanges` : relais de changements pour les vues hors
  « Aujourd'hui » ; instanciée dans `+layout.svelte`, partagée par contexte).
  Ne jamais importer `$lib/server/*` depuis ce dossier.
- `src/lib/components/today/` — cartes de l'écran « Aujourd'hui » (couche,
  alimentation, sommeil, minuteurs actifs) et leurs panneaux (biberon,
  tire-lait), consommant `SyncStore` via `getContext('sync')`.
- `src/lib/components/history/` — écran « Historique » (FR-006/007/009/010) :
  `DayPicker`/`DayTimeline`/`WeekView`/`EventList` (lecture, sélecteur jour,
  timeline 24 h, vue semaine), `EventEditSheet`/`ManualAddSheet` (édition,
  suppression douce annulable 5 s, saisie manuelle), toutes consommant
  `dailySummary`/`weeklySummary`. `GET /api/events` prend un paramètre
  `overlap=1` (événements chevauchant la fenêtre, pas seulement ceux qui y
  commencent) pour que les sessions à cheval sur minuit restent visibles.
- Horodatages ISO 8601 UTC ; données sous `DATA_DIR` (défaut `data/`).
- UI en français ; code, identifiants et commentaires en anglais.

## Agent skills

### Issue tracker

Issues suivies dans GitHub Issues via le CLI `gh` ; les PRs externes ne sont pas
une surface de triage. See `docs/agents/issue-tracker.md`.

### Triage labels

Vocabulaire canonique par défaut (needs-triage, needs-info, ready-for-agent,
ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context : `CONTEXT.md` à la racine + `docs/adr/`. See `docs/agents/domain.md`.
