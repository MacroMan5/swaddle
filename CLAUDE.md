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
  `npx playwright install chromium` une première fois ; les ports 3000 et 3001
  doivent être libres). Un seul spec : `npx playwright test e2e/<nom>.spec.ts`.
- `npm run build` — build de production (adapter-node → `build/`) ; démarrage
  avec `node server.js` (point d'entrée maison qui pose les en-têtes de
  sécurité sur les fichiers statiques), jamais `node build`.
- `docker build -t swaddle .` — image de production (`node:22-slim`, jamais Alpine).
- CI : runner self-hosted **Windows** (`swaddle-win`) — rien de Linux-only dans
  `ci.yml` (pas de `setup-qemu-action`, pas de `--with-deps`).

## Architecture

Monolithe SvelteKit 2 (Svelte 5, adapter-node) servant UI et API (ADR 0001) :

- `src/lib/server/db/` — couche SQLite : `openDb`/`getDb` (WAL, `foreign_keys ON`),
  migrations embarquées versionnées par `user_version` dans `migrations.ts`.
  Schéma v1 + v2 (index UNIQUE minuteur actif) : `household`, `baby`,
  `caregiver`, `event` (JSON `details` par type). Le mapping colonne↔DTO et
  l'insertion fidèle vivent dans `src/lib/server/events/eventRow.ts`, partagés
  par le repo et `settings/transfer.ts`.
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
  `/api/auth/pin`, `/api/export/json|csv`, `/api/backup`, `/api/restore`,
  `/api/server-info` (bloc « Ce serveur », `serverInfo.ts`) —
  contrat détaillé dans `docs/api/settings-api.md`.
- `src/hooks.server.ts` — porte configuration incomplète → `/setup` et porte
  code PIN → `/pin` (pages) / `401 pin_required` (API), à partir de
  `gateDecision`. Pages : `/setup` (assistant premier lancement), `/pin`
  (déverrouillage), `/settings` (réglages complets, FR-011). Le hook applique
  aussi `applySecurityHeaders` (`src/lib/server/securityHeaders.ts`) à toute
  réponse ; la CSP same-origin (mode nonce, pour l'amorce de thème inline de
  `app.html`) est configurée dans `vite.config.ts`, et `server.js` répète les
  en-têtes de base sur les fichiers statiques servis avant le hook — contrat
  dans `docs/api/events-api.md` § En-têtes de sécurité.
- `src/app.css` — design tokens Tailwind v4 (`@theme`) + variables shadcn
  re-mappées ; mode sombre par classe `.dark` sur `<html>`. Toute couleur/rayon
  passe par un token (NFR-008) ; échelle typographique en tokens `--text-*`
  (direction « Registre » 2b : corps 14 px, champs de saisie ≥ 16 px — pas de
  zoom iOS) ; cibles tactiles ≥ 48 px.
- `src/lib/components/ui/` — composants shadcn-svelte (ajouts via
  `npx shadcn-svelte@latest add <composant> -y`).
- `src/lib/client/` — couche client partagée par « Aujourd'hui » et
  « Historique » : `api.ts` (fetch typé vers `docs/api/events-api.md`,
  `ApiError` — dont le `userMessage` français, dérivé du `code` via
  `$lib/errors.ts` ; l'UI affiche toujours `userMessage`, jamais
  `error.message` (texte serveur anglais) —, `listEvents(babyId, from, to,
  overlap?)` pour l'historique),
  `format.ts` (`formatElapsed`/`formatClock`/`nursingDurationMs`/
  `todayRangeIso`), `summaries.ts` (moteur pur de résumés — FR-010, AC-006 :
  `dailySummary`/`weeklySummary`/`splitDurationByLocalDay` répartissent les
  événements à cheval sur minuit par jour local, testé DST dans les deux sens ;
  seule source de vérité, consommé par `DaySummary`, `WeekView` et `/history` ;
  `weekTotals`/`signedDeltaLabel` pour le comparatif semaine),
  `babyAge.ts` (âge court FR depuis `birthdate`, pur),
  `volume.ts` (unité de volume du foyer, #44 : `mlToOz`/`ozToMl`,
  `formatVolume`, pas et préréglages par unité, bornes en oz. `parseVolumeEntry`
  arrondit d'abord la saisie à la précision affichée (1 décimale en oz),
  la valide contre les bornes de cette unité, puis convertit — sinon une
  saisie hors bornes (0,04 oz) se convertirait en millilitres légaux (1 ml)
  et reviendrait affichée « 0,0 oz ». Le stockage
  reste en millilitres entiers — toute conversion d’affichage se redérive du
  `volumeMl` canonique, jamais d’une valeur convertie conservée côté client ;
  l’unité courante vient de `page.data.volumeUnit`, posé par
  `src/routes/+layout.server.ts`),
  `sync.svelte.ts` (`SyncStore`, classe à runes qui possède la connexion SSE,
  les événements du jour, les minuteurs actifs, l'offset serveur — RISK-001 —
  et `subscribeChanges` : relais de changements pour les vues hors
  « Aujourd'hui » ; instanciée dans `+layout.svelte`, partagée par contexte),
  `eventList.ts` (`upsert` — fusion idempotente last-write-wins gardée par
  `updatedAt` —, les tris `sortByStartedAtAsc/Desc`/`sortByDeletedAtDesc` et
  `isDeletion` — le seul module qui décide « cette change signifie-t-elle
  supprimé » (#88) ; toute liste d'événements côté client passe par là,
  jamais par une copie locale),
  `bufferedFetch.ts` (`BufferedFetch` : garde anti-course des fetchs
  chevauchants — jeton de supersession + buffer de replay des changes reçues
  en vol ; consommé par `SyncStore`, `HistoryWindow` et la feuille
  « Supprimés récemment », jamais recopié à la main).
  Ne jamais importer `$lib/server/*` depuis ce dossier.
- `src/lib/components/today/` — écran « Aujourd'hui » en direction « Registre »
  (palette 2b, `docs/design/design-system.md`) : `TodayHeader` (titre + âge),
  `StatusStrip` (temps écoulé par catégorie), `QuickActions` (tuiles héros +
  sélecteur couche + rangée sommeil/tirage), `RecentEvents`, `DaySummary`
  (ancré en bas), `ActiveTimerBanner` (bandeau plein accent,
  `data-testid="active-timers"`), les feuilles `BottleSheet`/`PumpSheet`/
  `NursingSheet`, et `todayDerivations.ts` (dérivations pures partagées :
  `CATEGORY_OF`, `lastOfCategory`, `activeCategories`). Tout consomme
  `SyncStore` via `getContext('sync')` ; les feuilles sont montées au niveau
  de la page (une seule instance chacune).
- `src/lib/components/history/` — écran « Historique » (FR-006/007/009/010) :
  `DaySelector`/`DayCalendar`/`WeekView`/`EventList` (sélecteur jour en bande,
  grille horaire 24 h, vue semaine avec comparatif « Semaine précédente » et
  moyennes 7 jours), `EventEditSheet`/`ManualAddSheet` (édition,
  suppression douce annulable 5 s, saisie manuelle), toutes consommant
  `dailySummary`/`weeklySummary`. `GET /api/events` prend un paramètre
  `overlap=1` (événements chevauchant la fenêtre, pas seulement ceux qui y
  commencent) pour que les sessions à cheval sur minuit restent visibles.
  Trois modules purs portent les règles partagées, hors composants :
  `eventDisplay.ts` (libellés FR, teintes, prédicats ponctuel/veille/lendemain),
  `dayCalendarLayout.ts` (géométrie de la grille, packing des chevauchements en
  colonnes, clipping de minuit) et `timelinePosition.ts` (`wallClockMinutesOf`,
  positionnement DST-safe). La grille et la liste décrivent ainsi le même
  événement de la même façon. `historyWindow.svelte.ts` (`HistoryWindow`,
  classe à runes instanciée par `/history`) possède l'état de l'écran : jour
  et mode sélectionnés, les trois chargements (jour / semaine / semaine
  précédente) avec un jeton anti-course chacun, le minuteur de squelette,
  l'abonnement à `subscribeChanges` et la fusion directe d'une écriture
  confirmée (FR-018) via l'`upsert` partagé. `+page.svelte` n'a plus que du
  markup et l'état de présentation (filtres, feuilles, toasts).
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
