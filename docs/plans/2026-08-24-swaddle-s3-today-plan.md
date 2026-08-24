# Slice 3 — Today Screen and Entry Flows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The main "Aujourd'hui" screen: category cards with last activity and elapsed time, a persistent active-timers card (FR-008), one-touch diaper with 5 s undo (FR-001), two-touch nursing with pause/resume/switch-side (FR-002), bottle form (FR-003), pump (FR-004), sleep start/stop (FR-005), bottom-sheet forms, timers computed locally from server time, live SSE sync, and the connection-loss banner (FR-018).

**Architecture:** Pure client slice on top of the merged slice-2 API (`docs/api/events-api.md` — read it first, it is the authoritative contract). One reactive sync store (Svelte 5 runes class) owns the EventSource connection, today's events, active timers and the server-time offset; page components read from it and write through small API helper functions. UI follows `docs/design/design-system.md` strictly (tokens only, ≥ 48 px targets, `tabular-nums`, dark mode first-class).

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), Tailwind v4 tokens, shadcn-svelte, lucide icons, Playwright e2e.

**Spec:** `docs/specs/2026-08-23-newborn-tracker-spec.md` (FR-001…FR-005, FR-008, FR-012, FR-018; AC-001, AC-002, AC-005; DEC-001, DEC-005; RISK-001). Design contracts: `docs/design/design-system.md` (« Aujourd'hui », « Formulaires », checklist UI).

## Global Constraints

- Installs: **always** `npm ci --ignore-scripts` first (node_modules absent in this worktree), and `--ignore-scripts` on any `npm install` / shadcn add.
- Code, identifiers, comments and commit messages in **English**; UI copy in **French**. No AI attribution anywhere (no Co-Authored-By, no Claude/AI/generated mentions, no session links).
- Every color/radius/shadow through a design token (NFR-008); touch targets ≥ 48 px; text ≥ 16 px; `tabular-nums` on every changing number; `prefers-reduced-motion` respected; no pure white in dark mode.
- Server time is authoritative (RISK-001): elapsed = `(Date.now() + serverOffset) − Date.parse(startedAt)`, clamped ≥ 0.
- Never present a write as saved before the server confirms (FR-018).
- **Parallel-slice boundary:** slice 5 (running concurrently) owns `/setup`, `/settings`, `/pin`, `hooks.server.ts`, and the `swaddle.caregiverId` localStorage key (this slice only *reads* that key, treating absence as `null`). Do NOT create a `/settings` or `/setup` route, not even a stub — the nav link may 404 until slice 5 merges, that is expected. If `main` moves under you, merge `origin/main` into the branch and resolve (for `package.json`/lock conflicts: keep both dep sets, rerun `npm install --ignore-scripts`).
- Verification: `npm run check`, `npm run test:unit`, `npm run test:e2e` (e2e = prod build; Playwright runs with `workers: 1`, DB seeded by `e2e/global-setup.ts` with baby `baby-1` / caregiver `cg-1`).

## Shared contracts produced by this slice

- `src/lib/client/api.ts` — typed fetch helpers (slice 4 reuses them).
- `src/lib/client/sync.svelte.ts` — `SyncStore` (slice 4 reuses it for history live updates).
- `src/lib/client/format.ts` — `formatElapsed`, `nursingDurationMs`, `todayRangeIso` (slice 4 reuses for summaries).
- App shell with bottom nav (Aujourd'hui `/`, Historique `/history`, Réglages `/settings`) in `src/routes/+layout.svelte`; `/history` is created here as an empty stub page (slice 4 owns its content, it is sequential after this slice).

---

### Task 1: Client utilities — time formatting and API helpers

**Files:**
- Create: `src/lib/client/format.ts`
- Create: `src/lib/client/api.ts`
- Test: `src/lib/client/format.test.ts`

**Interfaces:**
- Produces:
  - `formatElapsed(ms: number): string` — clamps to ≥ 0; `"0 min"` under a minute, `"12 min"` under an hour, `"1 h 05"` beyond (French, no seconds — the design shows calm minute-level elapsed times on cards).
  - `formatClock(ms: number): string` — `"MM:SS"` under an hour, `"H:MM:SS"` beyond, for running timers; clamps ≥ 0.
  - `nursingDurationMs(segments: {startedAt: string; endedAt: string | null}[], nowMs: number): number` — sum of segment durations; an open segment counts up to `nowMs` (pause excluded by construction, DEC-001).
  - `todayRangeIso(now: Date): { from: string; to: string }` — local-midnight boundaries as UTC ISO strings.
  - `api.ts`: `getJson<T>(url)`, `sendJson<T>(method, url, body)` — throw `ApiError { status, code, message }` parsed from the `{error}` envelope; `EventDTO`-typed wrappers: `listTodayEvents(babyId)`, `createEvent(input)`, `deleteEvent(id)`, `restoreEvent(id)`, `getTimers(babyId)`, `startTimer(type, body)`, `stopTimer(type, body)`, `nursingAction(body)` — routes and shapes exactly as documented in `docs/api/events-api.md`.

- [x] **Step 1: Write the failing tests** — `src/lib/client/format.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { formatElapsed, formatClock, nursingDurationMs, todayRangeIso } from './format';

describe('formatElapsed', () => {
	it('clamps negative to zero (server clock ahead)', () => {
		expect(formatElapsed(-5000)).toBe('0 min');
	});
	it('formats minutes and hours in French', () => {
		expect(formatElapsed(12 * 60_000)).toBe('12 min');
		expect(formatElapsed(65 * 60_000)).toBe('1 h 05');
	});
});

describe('formatClock', () => {
	it('formats MM:SS then H:MM:SS', () => {
		expect(formatClock(0)).toBe('00:00');
		expect(formatClock(83_000)).toBe('01:23');
		expect(formatClock(3_723_000)).toBe('1:02:03');
	});
	it('clamps negative to 00:00', () => {
		expect(formatClock(-1)).toBe('00:00');
	});
});

describe('nursingDurationMs (DEC-001: pause excluded)', () => {
	it('sums closed segments and counts the open one up to now', () => {
		const t0 = Date.parse('2026-08-24T10:00:00.000Z');
		const segments = [
			{ startedAt: '2026-08-24T10:00:00.000Z', endedAt: '2026-08-24T10:10:00.000Z' },
			{ startedAt: '2026-08-24T10:15:00.000Z', endedAt: null }
		];
		// 10 min closed + 5 min open (10:15 → 10:20); the 5 min pause is excluded.
		expect(nursingDurationMs(segments, t0 + 20 * 60_000)).toBe(15 * 60_000);
	});
});

describe('todayRangeIso', () => {
	it('spans local midnight to next local midnight', () => {
		const { from, to } = todayRangeIso(new Date(2026, 7, 24, 14, 30));
		expect(Date.parse(to) - Date.parse(from)).toBe(24 * 3_600_000);
		expect(new Date(from).getHours()).toBe(0);
	});
});
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/lib/client/format.test.ts` → FAIL (module not found).

- [x] **Step 3: Implement `format.ts`**

```ts
export function formatElapsed(ms: number): string {
	const minutes = Math.max(0, Math.floor(ms / 60_000));
	if (minutes < 60) return `${minutes} min`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return `${h} h ${String(m).padStart(2, '0')}`;
}

export function formatClock(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const s = total % 60;
	const m = Math.floor(total / 60) % 60;
	const h = Math.floor(total / 3600);
	const mm = String(m).padStart(2, '0');
	const ss = String(s).padStart(2, '0');
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function nursingDurationMs(
	segments: { startedAt: string; endedAt: string | null }[],
	nowMs: number
): number {
	return segments.reduce((sum, s) => {
		const end = s.endedAt === null ? nowMs : Date.parse(s.endedAt);
		return sum + Math.max(0, end - Date.parse(s.startedAt));
	}, 0);
}

export function todayRangeIso(now: Date): { from: string; to: string } {
	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
	return { from: start.toISOString(), to: end.toISOString() };
}
```

Implement `api.ts` with the typed helpers listed in Interfaces (import the `EventDTO`-shaped types from a small `src/lib/client/types.ts` re-declaring the DTO — do NOT import from `$lib/server/*` in client code). Every helper hits exactly the routes in `docs/api/events-api.md`; non-2xx responses parse the envelope and throw `ApiError`.

- [x] **Step 4: Run to verify pass** — `npx vitest run src/lib/client/format.test.ts` → PASS. `npm run check` → clean.

- [x] **Step 5: Commit** — `git add src/lib/client docs/plans/2026-08-24-swaddle-s3-today-plan.md && git commit -m "feat: add client time utilities and API helpers"`

---

### Task 2: SyncStore — SSE client with reconnect and server offset

**Files:**
- Create: `src/lib/client/sync.svelte.ts`
- Test: `src/lib/client/sync.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `class SyncStore` with:
  - `events: EventDTO[]` (today, non-deleted, `startedAt` DESC), `timers: EventDTO[]` (active), `connected: boolean`, `serverOffsetMs: number`, `nowMs: number` (ticks every second via `$state` + interval, used by all elapsed displays);
  - `start(babyId: string): void` — opens `EventSource('/api/stream')`; on `snapshot`: set offset (`Date.parse(serverTime) − Date.now()`), replace `timers`, refetch today's events; on `sync`: update offset and apply the change (`created` → insert if in today's range; `updated`/`restored` → upsert + refresh `timers` membership; `deleted` → remove); on `error`: `connected = false` (EventSource auto-reconnects; a new `snapshot` restores authoritative state — FR-012/AC-005);
  - `stop(): void`; `applyChange(change): void` exposed for unit tests.
- Design note: keep DOM/EventSource access behind `if (browser)`; the pure state transitions (`applyChange`, offset math, today filtering) are plain methods so Vitest covers them without a DOM.

- [x] **Step 1: Write the failing tests** — `sync.test.ts` covering the pure parts: `applyChange` insert (today) / ignore (yesterday) / update / delete / restore; timer list membership after a `sync` that sets `endedAt`; `serverOffsetMs` computed from a snapshot `serverTime` 30 s ahead of a fake `Date.now`. Use real `EventDTO` literals (diaper + sleep timer).
- [x] **Step 2: Run to verify failure.**
- [x] **Step 3: Implement `sync.svelte.ts`** (runes: `$state` fields; `setInterval` guarded by `browser` and cleared in `stop()`; interval ticks `nowMs = Date.now() + this.serverOffsetMs`).
- [x] **Step 4: Run to verify pass**, plus `npm run check`.
- [x] **Step 5: Commit** — `feat: add reactive SSE sync store`

---

### Task 3: App shell — bottom navigation

**Files:**
- Modify: `src/routes/+layout.svelte`
- Create: `src/lib/components/BottomNav.svelte`
- Create: `src/routes/history/+page.svelte` (stub for slice 4)

**Interfaces:**
- Produces: fixed bottom nav, 3 destinations (Aujourd'hui `/` icon `house`, Historique `/history` icon `calendar-days`, Réglages `/settings` icon `settings`), icon + French label, active state marked by `text-primary` AND an indicator bar (color is never the only signal), targets ≥ 48 px, `pb-[env(safe-area-inset-bottom)]`, `min-h-dvh` on the page wrapper. `/settings` is a link only — the route belongs to slice 5.

- [x] **Step 1: Implement** `BottomNav.svelte` (reads `page.url.pathname` from `$app/state`) and rework `+layout.svelte`: `min-h-dvh flex flex-col bg-surface text-ink`, `<main class="flex-1 pb-20">{@render children()}</main>`, nav fixed bottom with `bg-surface-raised border-t border-border`. `/history/+page.svelte` stub: a heading « Historique » + muted « Bientôt » paragraph (slice 4 replaces it).
- [x] **Step 2: Verify** — `npm run check`; `npm run dev` briefly and confirm the shell renders (or rely on the Task 8 e2e).
- [x] **Step 3: Commit** — `feat: add app shell with bottom navigation`

---

### Task 4: Today page skeleton + diaper card with 5 s undo (FR-001)

**Files:**
- Rewrite: `src/routes/+page.svelte` (replace the construction placeholder)
- Create: `src/lib/components/today/DiaperCard.svelte`
- Create: `src/lib/components/UndoToast.svelte`
- Test: `e2e/today-diaper.spec.ts`

**Interfaces:**
- Consumes: `SyncStore` (page instantiates ONE store via `setContext('sync', …)`, children `getContext`), `api.createEvent`/`deleteEvent`, baby id fetched once from `GET /api/babies` (first baby), caregiver id from `localStorage.getItem('swaddle.caregiverId')` (may be null).
- Produces:
  - Page order (FR-008): ActiveTimersCard (Task 6, placeholder slot until then) → feed card (Task 5) → diaper card → sleep card (Task 6) → summary line (Task 7). Empty state when no events: « Aucune activité — tout commence ici ».
  - `DiaperCard`: `bg-diaper-100`-tinted card (dark variant per design table), lucide `droplets` icon in `*-700`, three ≥ 48 px buttons **Pipi / Caca / Les deux**, immediate `active:scale-[0.97]` feedback; on tap → `createEvent({type:'diaper', startedAt: nowIso, details:{pee,poo}, babyId, caregiverId})`; only after the 201 → show UndoToast; on `ApiError` → keep the card enabled and show the error inline (FR-018: nothing is "saved" before the server says so). Card shows last diaper (« Pipi · il y a 25 min ») from the store.
  - `UndoToast`: `aria-live="polite"`, fixed above the nav, shows label + « Annuler » button ≥ 48 px for 5000 ms (DEC-005), never steals focus; `onUndo` → `deleteEvent(id)`; component is generic (message + action callback) so later flows reuse it.

- [x] **Step 1: Write the failing e2e** — `e2e/today-diaper.spec.ts`

```ts
import { expect, test } from '@playwright/test';

test('AC-001: one-touch diaper is recorded and undoable for 5 s', async ({ page, request }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Pipi', exact: true }).click();

	const toast = page.getByRole('status');
	await expect(toast).toContainText('Couche enregistrée');
	await expect(toast.getByRole('button', { name: 'Annuler' })).toBeVisible();

	// The event exists server-side…
	const before = await (await request.get('/api/events?babyId=baby-1')).json();
	const diaper = before.events.find(
		(e: { type: string; details: { pee: boolean } }) => e.type === 'diaper' && e.details.pee
	);
	expect(diaper).toBeTruthy();

	// …and Annuler soft-deletes it.
	await toast.getByRole('button', { name: 'Annuler' }).click();
	await expect(toast).toBeHidden();
	const after = await (await request.get('/api/events?babyId=baby-1')).json();
	expect(after.events.map((e: { id: string }) => e.id)).not.toContain(diaper.id);
});

test('the toast disappears by itself after 5 s', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Caca', exact: true }).click();
	await expect(page.getByRole('status')).toBeVisible();
	await expect(page.getByRole('status')).toBeHidden({ timeout: 7000 });
});
```

- [x] **Step 2: Run to verify failure** — `npx playwright test e2e/today-diaper.spec.ts` → FAIL (buttons absent).
- [x] **Step 3: Implement** the page skeleton, `DiaperCard`, `UndoToast` per the Interfaces block. Tokens only; last-activity line uses `formatElapsed(store.nowMs − Date.parse(startedAt))` with `tabular-nums`.
- [x] **Step 4: Run to verify pass** — the two tests above + `npm run check`.
- [x] **Step 5: Commit** — `feat: add today page with one-touch diaper and undo toast`

---

### Task 5: Feeding card — nursing (two-touch), bottle sheet, pump sheet

**Files:**
- Create: `src/lib/components/today/FeedCard.svelte`
- Create: `src/lib/components/today/BottleSheet.svelte`
- Create: `src/lib/components/today/PumpSheet.svelte`
- Modify: `src/routes/+page.svelte` (mount FeedCard)
- Test: `e2e/today-nursing.spec.ts`

**Interfaces:**
- Consumes: store + api helpers; shadcn-svelte **Sheet** — install first: `npx shadcn-svelte@latest add sheet -y` then `npm install --ignore-scripts` if the add touched package.json. Sheet side `bottom`, close affordance visible (design « Formulaires »).
- Produces:
  - `FeedCard` (`bg-feed-100` family, `heart`/`milk`/`wind` lucide icons): shows last feeding summary; three buttons ≥ 48 px: **Allaiter** → expands inline side chooser **Gauche / Droite** (second touch starts: `startTimer('nursing', {side})` — FR-002 two touches, no sheet); **Biberon** → opens BottleSheet; **Tirage** → opens PumpSheet. If a nursing/pump timer is already active, the corresponding button shows « En cours » state and scrolls to the active card instead of starting.
  - `BottleSheet` (FR-003): milk type segmented control (Maternel / Préparation / Mixte — last used type preselected via `localStorage 'swaddle.lastMilkType'`), volume input `inputmode="decimal"` with visible label and unit « ml », time input `type="datetime-local"` initialized to now; submit → `createEvent({type:'bottle', …})`; server 400 issues render under the fields (cause + correction, FR-017/FR-018); submit button disabled + spinner while pending.
  - `PumpSheet` (FR-004): side chooser Gauche / Droite / Les deux → `startTimer('pump', {side})`; volume is entered at stop time in the ActiveTimersCard (Task 6).

- [ ] **Step 1: Write the failing e2e** — `e2e/today-nursing.spec.ts`

```ts
import { expect, test } from '@playwright/test';

test.afterEach(async ({ request }) => {
	for (const type of ['nursing', 'pump', 'sleep'])
		await request.post(`/api/timers/${type}/stop`, {
			data: { babyId: 'baby-1', ...(type === 'pump' ? { volumeMl: 10 } : {}) }
		});
});

test('AC-002: nursing starts in two touches and builds segments', async ({ page, request }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Allaiter' }).click();
	await page.getByRole('button', { name: 'Gauche' }).click();

	// Active card appears with a running clock.
	const active = page.getByTestId('active-timers');
	await expect(active).toContainText('Allaitement');
	await expect(active).toContainText('Gauche');

	await active.getByRole('button', { name: 'Changer de côté' }).click();
	await expect(active).toContainText('Droite');
	await active.getByRole('button', { name: 'Pause' }).click();
	await expect(active.getByRole('button', { name: 'Reprendre' })).toBeVisible();
	await active.getByRole('button', { name: 'Reprendre' }).click();
	await active.getByRole('button', { name: 'Terminer' }).click();
	await expect(active).toBeHidden();

	const { timers } = await (await request.get('/api/timers?babyId=baby-1')).json();
	expect(timers).toHaveLength(0);
	const { events } = await (await request.get('/api/events?babyId=baby-1')).json();
	const nursing = events.find((e: { type: string }) => e.type === 'nursing');
	expect(nursing.details.segments.length).toBeGreaterThanOrEqual(3);
	expect(nursing.details.segments.map((s: { side: string }) => s.side)).toContain('right');
});

test('bottle sheet records type, volume and rejects a 1500 ml volume inline', async ({ page, request }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Biberon' }).click();
	await page.getByRole('button', { name: 'Préparation' }).click();
	await page.getByLabel(/volume/i).fill('1500');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByText(/1000/)).toBeVisible(); // inline FR-017 error, sheet stays open
	await page.getByLabel(/volume/i).fill('90');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByRole('status')).toContainText('Biberon');
	const { events } = await (await request.get('/api/events?babyId=baby-1')).json();
	const bottle = events.find((e: { type: string }) => e.type === 'bottle');
	expect(bottle.details).toMatchObject({ milkType: 'formula', volumeMl: 90 });
});
```

Note: the first test also exercises Task 6's ActiveTimersCard controls — implement Tasks 5 and 6 against this same spec; it goes green at the end of Task 6.

- [x] **Step 2: Run to verify failure.**
- [x] **Step 3: Implement** FeedCard + BottleSheet + PumpSheet per Interfaces (bottle success also shows the UndoToast with « Biberon enregistré »).
- [x] **Step 4:** `npm run check` clean; bottle test may still fail on the active-card assertions — acceptable until Task 6.
- [x] **Step 5: Commit** — `feat: add feeding card with nursing start and bottle/pump sheets`

---

### Task 6: Active-timers card and sleep card (FR-005, FR-008)

**Files:**
- Create: `src/lib/components/today/ActiveTimersCard.svelte`
- Create: `src/lib/components/today/SleepCard.svelte`
- Modify: `src/routes/+page.svelte` (mount both; active card pinned on top)
- Test: `e2e/today-sleep.spec.ts` (+ the Task 5 spec goes green)

**Interfaces:**
- Consumes: store (`timers`, `nowMs`), `stopTimer`, `nursingAction`, `formatClock`, `nursingDurationMs`.
- Produces:
  - `ActiveTimersCard` (`data-testid="active-timers"`, hidden when no active timer): one row per active timer — category icon + French label (Allaitement / Tirage / Sommeil), running clock in `tabular-nums` (`formatClock`); nursing rows show current side (Gauche/Droite), effective duration via `nursingDurationMs`, and the paused state (« En pause ») with controls **Changer de côté / Pause|Reprendre / Terminer**; pump rows show a volume input (`inputmode="decimal"`, label « Volume (ml) ») required by **Terminer** (the API rejects a stop without volume); sleep rows show **Réveillé**. All stop/action buttons call the API and rely on the SSE `sync` to update state.
  - `SleepCard` (`bg-sleep-100` family, `moon` icon): shows last completed sleep; one button **Commencer le sommeil** → `startTimer('sleep')`; while a sleep timer is active the button is replaced by the elapsed time + hint « voir en haut » (single CTA per screen; the stop lives in the active card as **Réveillé**).

- [ ] **Step 1: Write the failing e2e** — `e2e/today-sleep.spec.ts`

```ts
import { expect, test } from '@playwright/test';

test('AC-005: a started sleep survives a reload with correct server-based elapsed', async ({ page, request }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Commencer le sommeil' }).click();
	const active = page.getByTestId('active-timers');
	await expect(active).toContainText('Sommeil');

	await page.reload();
	await expect(page.getByTestId('active-timers')).toContainText('Sommeil');
	// The clock shows a small positive elapsed, computed from the server start.
	await expect(page.getByTestId('active-timers')).toContainText(/00:0\d/);

	await page.getByRole('button', { name: 'Réveillé' }).click();
	await expect(page.getByTestId('active-timers')).toBeHidden();
	const { timers } = await (await request.get('/api/timers?babyId=baby-1')).json();
	expect(timers).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** both components per Interfaces.
- [ ] **Step 4: Run** `npx playwright test e2e/today-sleep.spec.ts e2e/today-nursing.spec.ts` → both files PASS now; `npm run check` clean.
- [ ] **Step 5: Commit** — `feat: add active timers card and sleep flow`

---

### Task 7: Category summaries on cards + connection banner (FR-008, FR-018)

**Files:**
- Create: `src/lib/components/ConnectionBanner.svelte`
- Modify: `src/routes/+page.svelte`, the three category cards (last-activity lines + a compact today count per card, e.g. « 3 couches aujourd'hui »)
- Test: extend `src/lib/client/sync.test.ts` (banner state) — the visual banner itself is covered by check + manual pass, not e2e (killing SSE deterministically in Playwright is not worth the flake risk).

**Interfaces:**
- Produces: `ConnectionBanner` — rendered from the layout when `store.connected === false` after a first successful connection: fixed top, `bg-danger`-toned via tokens with icon + text « Connexion perdue — reconnexion… », `aria-live="polite"`. Cards each show: last event of their category (`formatElapsed` ago) and today's count from `store.events`.

- [ ] **Step 1:** Unit-test the store's `connected` transitions (open → true, error → false, snapshot → true again).
- [ ] **Step 2:** Implement banner + card summary lines.
- [ ] **Step 3:** `npm run test:unit` + `npm run check` green.
- [ ] **Step 4: Commit** — `feat: add connection banner and per-card today summaries`

---

### Task 8: Design-system pass, docs, full verification

**Files:**
- Modify: any component needing fixes; `CLAUDE.md` (Architecture: one bullet for `src/lib/client/` + today components)
- Test: `e2e/today-a11y.spec.ts`

**Interfaces:** —

- [ ] **Step 1: Write the viewport/dark e2e** — `e2e/today-a11y.spec.ts`: for widths 320, 390, 768: `page.setViewportSize`, goto `/`, assert no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`), the three quick-action buttons have bounding boxes ≥ 48 px tall; then add class `dark` on `<html>` via `page.evaluate` and assert the page body background is not pure white (`getComputedStyle(document.body).backgroundColor !== 'rgb(255, 255, 255)'`).
- [ ] **Step 2:** Run the design-system delivery checklist (`docs/design/design-system.md`, bottom) against every component built in this slice; fix violations (hard-coded colors, missing `tabular-nums`, missing `motion-reduce`, focus rings).
- [ ] **Step 3:** Update `CLAUDE.md` Architecture with: `src/lib/client/` (api, format, sync store) and `src/lib/components/today/`.
- [ ] **Step 4: Full verification** — `npm run check && npm run test:unit && npm run test:e2e` all green.
- [ ] **Step 5: Commit** — `docs: document today-screen client architecture` (plus any `fix:` commits from the checklist pass).

---

## Self-review notes (already applied)

- FR-001/002/003/004/005/008 each map to a task above; FR-012 client side = SyncStore; FR-018 = banner + inline errors + pending states; AC-001/002/005 have dedicated e2e.
- The nursing « two touches » counts Allaiter → side, with no sheet in between (design § Allaitement).
- All server writes go through slice-2 endpoints; nothing invents server code, no schema change.
- e2e specs leave no active timers behind (afterEach stops) so parallel-file pollution stays impossible under `workers: 1`.
