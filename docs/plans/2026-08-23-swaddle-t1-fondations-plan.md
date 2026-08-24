# Swaddle — Tranche 1 : Fondations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un squelette SvelteKit fonctionnel avec design tokens, base SQLite migrée en WAL, endpoint de santé, image Docker multi-arch — la fondation sur laquelle les tranches 2–6 construisent les fonctionnalités.

**Architecture:** Monolithe SvelteKit (adapter-node) servant UI et API dans un processus (ADR 0001). SQLite via better-sqlite3 en WAL avec migrations embarquées versionnées par `user_version`. Design system Tailwind CSS v4 (tokens dans `@theme`) + shadcn-svelte, mode sombre par classe (ADR 0003). Image `node:22-slim` multi-arch publiée sur GHCR par le workflow existant (ADR 0002).

**Tech Stack:** SvelteKit 2 (Svelte 5), TypeScript, better-sqlite3, Tailwind CSS v4, shadcn-svelte, lucide-svelte, Vitest, Playwright, Docker.

**Spec:** `docs/specs/2026-08-23-newborn-tracker-spec.md` (implémente NFR-004, NFR-006, NFR-007, NFR-008 ; prépare FR-016 via l'état `setupComplete`).

## Global Constraints

- Node 22, base Docker glibc `node:22-slim` — jamais Alpine (ADR 0002, RISK-004).
- Aucune requête vers un domaine tiers, polices incluses (NFR-006).
- Toute couleur/ombre/rayon passe par un token `@theme` — aucune valeur en dur dans les composants (NFR-008).
- SQLite en WAL, `foreign_keys = ON`, transactions courtes (NFR-004).
- Horodatages stockés en ISO 8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`).
- Les données vivent sous `DATA_DIR` (défaut `data/`), jamais versionnées.
- Interface en français ; code et commits en anglais.
- L'app écoute sur le port 3000 dans le conteneur (mappé 3010 côté hôte).

---

### Task 1: Squelette SvelteKit + outillage de test

**Files:**
- Create: projet SvelteKit à la racine du dépôt (`package.json`, `svelte.config.js`, `vite.config.ts`, `src/…`)
- Modify: `.gitignore` (ajouts générés par le template)

**Interfaces:**
- Produces: commandes `npm run dev`, `npm run build`, `npm run test:unit` (Vitest), `npm run test:e2e` (Playwright), `npm run check` — utilisées par toutes les tranches.

- [ ] **Step 1: Générer le squelette dans le dépôt existant**

Le dépôt contient déjà `docs/`, `deploy/`, `README.md` — générer dans un dossier temporaire puis fusionner :

```bash
npx sv create swaddle-tmp --template minimal --types ts --no-add-ons --no-install
# Copier le contenu de swaddle-tmp/ à la racine SANS écraser README.md ni .gitignore
# (fusionner à la main les entrées .gitignore générées : node_modules, /build, /.svelte-kit, etc.)
rm -rf swaddle-tmp
npm install
```

- [ ] **Step 2: Ajouter adapter-node, Vitest et Playwright**

```bash
npm install -D @sveltejs/adapter-node vitest @playwright/test
```

Dans `svelte.config.js`, remplacer l'adaptateur :

```js
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: { adapter: adapter() }
};

export default config;
```

Ajouter dans `package.json` (scripts) :

```json
{
	"test:unit": "vitest run",
	"test:e2e": "playwright test",
	"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"
}
```

Créer `playwright.config.ts` :

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	webServer: {
		command: 'npm run build && node build',
		port: 3000,
		env: { DATA_DIR: '.playwright-data' },
		reuseExistingServer: false
	},
	use: { baseURL: 'http://localhost:3000' }
});
```

Ajouter `.playwright-data/` et `test-results/` au `.gitignore`.

- [ ] **Step 3: Vérifier build et dev**

Run: `npm run build && npm run check`
Expected: build sans erreur, 0 erreur svelte-check.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: scaffold SvelteKit app with adapter-node, Vitest and Playwright"
```

---

### Task 2: Design tokens Tailwind v4 + mode sombre

**Files:**
- Create: `src/app.css`
- Modify: `vite.config.ts`, `src/routes/+layout.svelte`, `src/app.html`

**Interfaces:**
- Produces: tokens `--color-feed-*`, `--color-diaper-*`, `--color-sleep-*`, `--color-surface`, `--color-surface-raised`, `--color-ink`, `--color-ink-muted`, `--radius-card`, variante `dark:` par classe sur `<html>`. Toutes les tranches UI les consomment.

- [ ] **Step 1: Installer Tailwind CSS v4**

```bash
npm install tailwindcss @tailwindcss/vite
```

Dans `vite.config.ts` :

```ts
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()]
});
```

- [ ] **Step 2: Écrire les tokens dans `src/app.css`**

```css
@import 'tailwindcss';

@custom-variant dark (&:where(.dark, .dark *));

@theme {
	/* Catégories (design : couleurs distinctes mais jamais seules porteuses de sens) */
	--color-feed-100: oklch(0.95 0.05 65);
	--color-feed-500: oklch(0.72 0.15 65);
	--color-feed-700: oklch(0.55 0.15 65);
	--color-diaper-100: oklch(0.95 0.05 180);
	--color-diaper-500: oklch(0.7 0.12 180);
	--color-diaper-700: oklch(0.5 0.12 180);
	--color-sleep-100: oklch(0.95 0.04 280);
	--color-sleep-500: oklch(0.65 0.14 280);
	--color-sleep-700: oklch(0.5 0.14 280);

	/* Sémantiques — redéfinis en sombre via variables CSS ci-dessous */
	--color-surface: var(--surface);
	--color-surface-raised: var(--surface-raised);
	--color-ink: var(--ink);
	--color-ink-muted: var(--ink-muted);

	--radius-card: 1rem;
	--font-sans: 'system-ui', 'Segoe UI', 'Roboto', sans-serif;
}

:root {
	--surface: oklch(0.98 0.005 260);
	--surface-raised: oklch(1 0 0);
	--ink: oklch(0.25 0.02 260);
	--ink-muted: oklch(0.5 0.02 260);
}

/* Mode sombre nocturne : pas de surface blanche agressive (NFR-005) */
.dark {
	--surface: oklch(0.18 0.02 260);
	--surface-raised: oklch(0.24 0.02 260);
	--ink: oklch(0.92 0.01 260);
	--ink-muted: oklch(0.65 0.01 260);
}

body {
	background-color: var(--color-surface);
	color: var(--color-ink);
}
```

- [ ] **Step 3: Charger le CSS et poser la classe de thème**

`src/routes/+layout.svelte` :

```svelte
<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

{@render children()}
```

Dans `src/app.html`, ajouter avant `</head>` (thème auto sans flash — FR-011 branchera le choix utilisateur en tranche 5) :

```html
<script>
	if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
		document.documentElement.classList.add('dark');
	}
</script>
```

- [ ] **Step 4: Page d'accueil provisoire prouvant les tokens**

`src/routes/+page.svelte` :

```svelte
<h1 class="p-4 text-2xl font-bold text-ink">Swaddle</h1>
<p class="px-4 text-ink-muted">Suivi bébé auto-hébergé — en construction.</p>
<div class="m-4 flex gap-2">
	<span class="rounded-card bg-feed-100 px-3 py-2 text-feed-700">Alimentation</span>
	<span class="rounded-card bg-diaper-100 px-3 py-2 text-diaper-700">Couche</span>
	<span class="rounded-card bg-sleep-100 px-3 py-2 text-sleep-700">Sommeil</span>
</div>
```

- [ ] **Step 5: Vérifier visuellement et builder**

Run: `npm run build && npm run check`
Expected: succès ; en dev (`npm run dev`), les trois pastilles colorées s'affichent, le mode sombre du système assombrit la page.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Tailwind v4 design tokens with class-based dark mode"
```

---

### Task 3: shadcn-svelte + composants de base

**Files:**
- Create: `src/lib/components/ui/…` (générés), `components.json`
- Modify: `src/app.css` (variables ajoutées par l'init), `src/routes/+page.svelte`

**Interfaces:**
- Produces: composants `Button`, `Card` importables depuis `$lib/components/ui/…` ; icônes via `@lucide/svelte`. Les tranches 2–5 ajoutent les composants manquants (`Sheet`, `Dialog`, `Tabs`…) avec la même CLI.

- [ ] **Step 1: Initialiser shadcn-svelte**

```bash
npx shadcn-svelte@latest init
# Réponses : base color = neutral, css = src/app.css, alias par défaut ($lib/components, $lib/utils)
npx shadcn-svelte@latest add button card
npm install @lucide/svelte
```

- [ ] **Step 2: Aligner les variables shadcn sur nos tokens**

L'init ajoute des variables `--background`, `--foreground`, etc. dans `src/app.css`. Les faire pointer vers nos sémantiques (pas de valeurs en dur) :

```css
:root {
	--background: var(--surface);
	--foreground: var(--ink);
	--card: var(--surface-raised);
	--card-foreground: var(--ink);
	--muted-foreground: var(--ink-muted);
}
```

(Conserver les autres variables générées ; seules celles listées ci-dessus sont re-mappées. La règle `.dark { … }` générée par l'init est supprimée pour ces clés — nos variables `.dark` de la Task 2 font foi.)

- [ ] **Step 3: Utiliser Button/Card sur la page provisoire**

Dans `src/routes/+page.svelte`, ajouter :

```svelte
<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Baby } from '@lucide/svelte';
</script>

<Card.Root class="m-4">
	<Card.Header>
		<Card.Title class="flex items-center gap-2"><Baby size={20} /> Swaddle</Card.Title>
	</Card.Header>
	<Card.Content>
		<Button class="min-h-12">Bouton de test (≥ 48 px)</Button>
	</Card.Content>
</Card.Root>
```

- [ ] **Step 4: Vérifier**

Run: `npm run build && npm run check`
Expected: succès ; le bouton et la carte suivent les tokens en clair et en sombre.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add shadcn-svelte with token-mapped theme variables"
```

---

### Task 4: Couche SQLite — migrations et ouverture WAL

**Files:**
- Create: `src/lib/server/db/migrations.ts`, `src/lib/server/db/index.ts`
- Test: `src/lib/server/db/db.test.ts`

**Interfaces:**
- Produces: `openDb(path?: string): Database.Database` (ouvre + migre), `migrate(db): void`, `migrations: string[]`. Schéma v1 : tables `household`, `baby`, `caregiver`, `event` — le contrat de données de toutes les tranches.

- [ ] **Step 1: Installer better-sqlite3**

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

- [ ] **Step 2: Écrire le test qui échoue**

`src/lib/server/db/db.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migrate, migrations } from './migrations';
import { openDb } from './index';

describe('migrations', () => {
	it('applies all migrations on an empty db and sets user_version', () => {
		const db = new Database(':memory:');
		migrate(db);
		expect(db.pragma('user_version', { simple: true })).toBe(migrations.length);
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
			.all()
			.map((r: any) => r.name);
		expect(tables).toEqual(expect.arrayContaining(['baby', 'caregiver', 'event', 'household']));
	});

	it('is idempotent', () => {
		const db = new Database(':memory:');
		migrate(db);
		expect(() => migrate(db)).not.toThrow();
		expect(db.pragma('user_version', { simple: true })).toBe(migrations.length);
	});

	it('enforces event type check constraint', () => {
		const db = new Database(':memory:');
		migrate(db);
		db.prepare(
			"INSERT INTO baby (id, name, birthdate, timezone, created_at) VALUES ('b1', 'Léa', '2026-08-01', 'America/Toronto', '2026-08-23T00:00:00.000Z')"
		).run();
		expect(() =>
			db
				.prepare(
					"INSERT INTO event (id, baby_id, type, started_at, details, created_at, updated_at) VALUES ('e1', 'b1', 'invalid', '2026-08-23T00:00:00.000Z', '{}', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')"
				)
				.run()
		).toThrow();
	});
});

describe('openDb', () => {
	it('opens in WAL mode with foreign keys on', () => {
		const db = openDb(':memory:');
		// :memory: reste en mode 'memory' ; foreign_keys est le contrat vérifiable
		expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
	});
});
```

- [ ] **Step 3: Vérifier l'échec**

Run: `npm run test:unit`
Expected: FAIL — modules `./migrations` et `./index` introuvables.

- [ ] **Step 4: Implémenter les migrations**

`src/lib/server/db/migrations.ts` :

```ts
import type Database from 'better-sqlite3';

// Une entrée par version de schéma. Ne JAMAIS modifier une migration publiée —
// en ajouter une nouvelle (les installations existantes migrent par user_version).
export const migrations: string[] = [
	`
	CREATE TABLE household (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		pin_hash TEXT,
		volume_unit TEXT NOT NULL DEFAULT 'ml' CHECK (volume_unit IN ('ml', 'oz')),
		theme TEXT NOT NULL DEFAULT 'auto' CHECK (theme IN ('light', 'dark', 'auto')),
		created_at TEXT NOT NULL
	);

	CREATE TABLE baby (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		birthdate TEXT NOT NULL,
		timezone TEXT NOT NULL,
		created_at TEXT NOT NULL
	);

	CREATE TABLE caregiver (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		color TEXT NOT NULL,
		created_at TEXT NOT NULL
	);

	CREATE TABLE event (
		id TEXT PRIMARY KEY,
		baby_id TEXT NOT NULL REFERENCES baby (id),
		caregiver_id TEXT REFERENCES caregiver (id),
		type TEXT NOT NULL CHECK (type IN ('nursing', 'bottle', 'pump', 'diaper', 'sleep')),
		started_at TEXT NOT NULL,
		ended_at TEXT,
		note TEXT,
		details TEXT NOT NULL DEFAULT '{}',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		deleted_at TEXT
	);

	CREATE INDEX idx_event_baby_time ON event (baby_id, started_at) WHERE deleted_at IS NULL;
	CREATE INDEX idx_event_active_timer ON event (baby_id, type) WHERE ended_at IS NULL AND deleted_at IS NULL;
	`
];

export function migrate(db: Database.Database): void {
	const current = db.pragma('user_version', { simple: true }) as number;
	for (let v = current; v < migrations.length; v++) {
		db.transaction(() => {
			db.exec(migrations[v]);
			db.pragma(`user_version = ${v + 1}`);
		})();
	}
}
```

Le champ `details` est un JSON par type (contrat pour les tranches 2–3) :
`nursing` → `{ segments: [{ side: 'left'|'right', startedAt, endedAt }], pausedMs: number }` ;
`bottle` → `{ milkType: 'breast'|'formula'|'mixed', volumeMl: number }` ;
`pump` → `{ side: 'left'|'right'|'both', volumeMl: number }` ;
`diaper` → `{ pee: boolean, poop: boolean }` ; `sleep` → `{}`.

- [ ] **Step 5: Implémenter l'ouverture**

`src/lib/server/db/index.ts` :

```ts
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrations';

const DATA_DIR = process.env.DATA_DIR ?? 'data';

export function openDb(path = `${DATA_DIR}/swaddle.db`): Database.Database {
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	migrate(db);
	return db;
}

let instance: Database.Database | undefined;

export function getDb(): Database.Database {
	instance ??= openDb();
	return instance;
}
```

- [ ] **Step 6: Vérifier le passage**

Run: `npm run test:unit`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add SQLite layer with versioned migrations and WAL"
```

---

### Task 5: Endpoint de santé et état d'installation

**Files:**
- Create: `src/routes/api/health/+server.ts`, `src/lib/server/setup.ts`
- Test: `src/lib/server/setup.test.ts`

**Interfaces:**
- Consumes: `openDb`, `getDb` (Task 4).
- Produces: `GET /api/health` → `{ status: 'ok', setupComplete: boolean }` ; `isSetupComplete(db): boolean`. La tranche 5 (onboarding, FR-016) redirige vers l'assistant quand `setupComplete` est faux.

- [ ] **Step 1: Écrire le test qui échoue**

`src/lib/server/setup.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { openDb } from './db';
import { isSetupComplete } from './setup';

describe('isSetupComplete', () => {
	it('is false on an empty database', () => {
		const db = openDb(':memory:');
		expect(isSetupComplete(db)).toBe(false);
	});

	it('is true once a baby and a caregiver exist', () => {
		const db = openDb(':memory:');
		const now = new Date().toISOString();
		db.prepare(
			'INSERT INTO baby (id, name, birthdate, timezone, created_at) VALUES (?, ?, ?, ?, ?)'
		).run('b1', 'Léa', '2026-08-01', 'America/Toronto', now);
		expect(isSetupComplete(db)).toBe(false);
		db.prepare('INSERT INTO caregiver (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
			'c1',
			'Émile',
			'#4f46e5',
			now
		);
		expect(isSetupComplete(db)).toBe(true);
	});
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npm run test:unit`
Expected: FAIL — `./setup` introuvable.

- [ ] **Step 3: Implémenter**

`src/lib/server/setup.ts` :

```ts
import type Database from 'better-sqlite3';

export function isSetupComplete(db: Database.Database): boolean {
	const babies = db.prepare('SELECT COUNT(*) AS n FROM baby').get() as { n: number };
	const caregivers = db.prepare('SELECT COUNT(*) AS n FROM caregiver').get() as { n: number };
	return babies.n > 0 && caregivers.n > 0;
}
```

`src/routes/api/health/+server.ts` :

```ts
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { isSetupComplete } from '$lib/server/setup';

export function GET() {
	return json({ status: 'ok', setupComplete: isSetupComplete(getDb()) });
}
```

- [ ] **Step 4: Vérifier le passage**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add health endpoint with setup-complete state"
```

---

### Task 6: E2E smoke test

**Files:**
- Create: `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: page d'accueil (Task 2–3), `GET /api/health` (Task 5), config Playwright (Task 1).

- [ ] **Step 1: Écrire le test**

`e2e/smoke.spec.ts` :

```ts
import { expect, test } from '@playwright/test';

test('home page renders with tokens applied', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Swaddle' })).toBeVisible();
});

test('health endpoint reports empty setup', async ({ request }) => {
	const res = await request.get('/api/health');
	expect(res.ok()).toBeTruthy();
	const body = await res.json();
	expect(body.status).toBe('ok');
	expect(body.setupComplete).toBe(false);
});
```

- [ ] **Step 2: Lancer**

```bash
rm -rf .playwright-data
npx playwright install chromium
npm run test:e2e
```

Expected: 2 tests PASS (le build de prod démarre, sert la page et l'API).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: add e2e smoke coverage for home page and health endpoint"
```

---

### Task 7: Dockerfile multi-stage et vérification CI

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: build SvelteKit (Task 1), `DATA_DIR` (Task 4).
- Produces: image conforme au compose de `deploy/docker-compose.yml` (port 3000, données dans `/app/data`) ; le workflow `release.yml` existant la publie sur GHCR aux tags `v*` (NFR-007).

- [ ] **Step 1: Écrire le Dockerfile**

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data PORT=3000
COPY --from=build /app/build build
COPY --from=build /app/node_modules node_modules
COPY package.json .
EXPOSE 3000
CMD ["node", "build"]
```

`.dockerignore` :

```
node_modules
build
.svelte-kit
data
.playwright-data
test-results
docs
deploy
.git
.github
```

- [ ] **Step 2: Vérifier localement**

```bash
docker build -t swaddle:dev .
docker run --rm -p 3010:3000 -v "$PWD/tmp-data:/app/data" swaddle:dev &
sleep 5 && curl -fsS http://localhost:3010/api/health
```

Expected: `{"status":"ok","setupComplete":false}`. Arrêter le conteneur et supprimer `tmp-data/`.

- [ ] **Step 3: Workflow CI (tests sur chaque push)**

`.github/workflows/ci.yml` :

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm run test:unit
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - run: docker build -t swaddle:ci .
```

- [ ] **Step 4: Commit et push, vérifier la CI**

```bash
git add -A
git commit -m "feat: add production Dockerfile and CI workflow"
git push
gh run watch --exit-status
```

Expected: workflow `ci` vert sur GitHub.

---

## Self-Review

- **Couverture spec (périmètre tranche 1)** : NFR-004 → Task 4 ; NFR-006 → tokens/polices système, aucun CDN (Task 2) ; NFR-007 → Task 7 + `release.yml` existant ; NFR-008 → Tasks 2–3 ; préparation FR-016 → Task 5. Les FR fonctionnels appartiennent aux tranches 2–5 (plans dédiés).
- **Placeholders** : aucun — chaque étape porte code ou commande exacte.
- **Cohérence des types** : `openDb`/`getDb`/`migrate`/`migrations`/`isSetupComplete` utilisés dans les Tasks 5–7 correspondent aux définitions des Tasks 4–5 ; le schéma `event.details` est documenté comme contrat pour les tranches suivantes.
