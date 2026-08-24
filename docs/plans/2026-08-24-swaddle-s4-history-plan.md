# Slice 4 — History, Editing and Summaries — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Historique tab and the calculation layer: manual after-the-fact entry (FR-006), edit/soft-delete with 5 s undo (FR-007), day selector + colored timeline + chronological list + category filters + day/week toggle (FR-009), daily and weekly summaries with midnight-crossing periods split across days (FR-010, AC-006 incl. DST).

**Architecture:** A pure summaries engine (`src/lib/client/summaries.ts`, exhaustively unit-tested — midnight and DST cases are the ticket's hard requirement) feeds both the Today SummaryCard (upgrade) and the History views. The server gains one small option (`overlap` listing — events *overlapping* a window, not just starting in it) since midnight-crossing events would otherwise be invisible to the day being viewed. History state lives in the page; live updates come from a small change-relay added to the existing `SyncStore`. Editing reuses the slice-2 PATCH/DELETE/restore endpoints and the slice-3 `UndoToast`.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), Tailwind v4 tokens, existing `src/lib/client/` modules, Vitest, Playwright.

**Spec:** `docs/specs/2026-08-23-newborn-tracker-spec.md` (FR-006, FR-007, FR-009, FR-010; AC-006; DEC-005/006). API: `docs/api/events-api.md`. Design: `docs/design/design-system.md` (§ Historique, § Formulaires, checklist).

## Global Constraints

- Installs: `npm ci --ignore-scripts` first; `--ignore-scripts` always.
- Code/identifiers/comments/commits in English; UI copy in French; NO AI attribution anywhere; conventional commits.
- Tokens only, ≥ 48 px targets, text ≥ 16 px, `tabular-nums` on numbers, `motion-reduce`, skeletons (not blocking spinners) for loads > 300 ms, timeline readable without color perception (icon/pattern per category).
- Timestamps ISO UTC; day boundaries are **local** days (`new Date(y, m, d)` math — never UTC slicing), durations from epoch differences (DST-safe).
- Server writes only through existing endpoints; never present a write as saved before server confirmation (FR-018); merge every confirmed HTTP response into local state (pattern established in slice 3).
- Verification: `npm run check`, `npm run test:unit`, `npm run test:e2e` (workers 1, two servers — leave both clean, no active timers).

## Contracts produced

- `src/lib/client/summaries.ts` — `dailySummary`, `weeklySummary`, `splitDurationByLocalDay` (Today's SummaryCard switches to it; slice 6 may reuse).
- `GET /api/events?...&overlap=1` — window overlap semantics (documented in `docs/api/events-api.md`).
- `SyncStore.subscribeChanges(fn)` — change relay for non-today views.
- `/history` page replacing the stub; `EventEditSheet` + `ManualAddSheet` components.

---

### Task 1: Summaries engine (FR-010, AC-006)

**Files:**
- Create: `src/lib/client/summaries.ts`
- Test: `src/lib/client/summaries.test.ts`

**Interfaces:**
- Consumes: `EventDTO` from `$lib/client/types`, `nursingDurationMs` from `./format`.
- Produces:
  - `splitDurationByLocalDay(startMs: number, endMs: number): Map<string, number>` — key `YYYY-MM-DD` (local), value ms allocated to that local day; boundaries via `new Date(y, m, d + 1)` iteration so DST days get their real 23/25 h span; total always equals `endMs − startMs`.
  - `type DailySummary = { nursing: { count: number; totalMs: number; leftMs: number; rightMs: number }; bottle: { count: number; totalMl: number }; pump: { count: number; totalMl: number }; diaper: { count: number; pee: number; poo: number }; sleep: { totalMs: number; completedCount: number; averageMs: number } }`
  - `dailySummary(events: EventDTO[], dayKey: string, nowMs: number): DailySummary` — counts attribute an event to the day of its `startedAt` (local); **durations** (nursing segments, sleep) are allocated per day via `splitDurationByLocalDay`, so a 23:30→01:30 sleep stays ONE entry but each day receives its share (FR-010); sleep `averageMs` uses completed periods only (DEC/design), open timers contribute duration up to `nowMs` to `totalMs` but not to `completedCount`; nursing left/right from segment sides.
  - `weeklySummary(events: EventDTO[], mondayKey: string, nowMs: number): { days: { dayKey: string; summary: DailySummary }[] }` — 7 consecutive local days starting at `mondayKey`.
  - `localDayKey(d: Date): string` and `dayRangeIso(dayKey: string): { from: string; to: string }` (local midnight → next local midnight, as UTC ISO; exported for the page's fetches).

- [ ] **Step 1: Write the failing tests** — `summaries.test.ts`. Pin the timezone FIRST LINE of the file, before any import that touches Date: `process.env.TZ = 'America/Toronto';` (Node honors TZ at first Date use; keep this file's tests self-contained). Cases — real code, no placeholders:

```ts
process.env.TZ = 'America/Toronto';
import { describe, it, expect } from 'vitest';
import { splitDurationByLocalDay, dailySummary, localDayKey, dayRangeIso } from './summaries';
import type { EventDTO } from './types';

const ms = (h: number, m = 0) => (h * 60 + m) * 60_000;
const local = (y: number, mo: number, d: number, h: number, mi = 0) =>
	new Date(y, mo - 1, d, h, mi).getTime();

function sleep(startMs: number, endMs: number | null): EventDTO {
	return {
		id: `s-${startMs}`, babyId: 'baby-1', caregiverId: null, type: 'sleep',
		startedAt: new Date(startMs).toISOString(),
		endedAt: endMs === null ? null : new Date(endMs).toISOString(),
		note: null, details: {}, createdAt: new Date(startMs).toISOString(),
		updatedAt: new Date(startMs).toISOString(), deletedAt: null
	};
}

describe('splitDurationByLocalDay', () => {
	it('keeps a same-day interval on one key', () => {
		const start = local(2026, 8, 24, 14, 0);
		const split = splitDurationByLocalDay(start, start + ms(2));
		expect([...split.entries()]).toEqual([['2026-08-24', ms(2)]]);
	});

	it('AC-006: splits 23:30→01:30 across the two days, total preserved', () => {
		const split = splitDurationByLocalDay(local(2026, 8, 24, 23, 30), local(2026, 8, 25, 1, 30));
		expect(split.get('2026-08-24')).toBe(ms(0, 30));
		expect(split.get('2026-08-25')).toBe(ms(1, 30));
	});

	it('DST fall-back (2026-11-01, America/Toronto): the 25-hour day gets its real duration', () => {
		// 00:30 → 03:30 local crosses the repeated 01:00–02:00 hour: 4 real hours.
		const start = local(2026, 11, 1, 0, 30);
		const end = start + ms(4); // epoch-based: unambiguous
		const split = splitDurationByLocalDay(start, end);
		expect(split.get('2026-11-01')).toBe(ms(4));
		expect([...split.keys()]).toEqual(['2026-11-01']);
	});

	it('DST spring-forward (2026-03-08): 23-hour day, midnight boundary still correct', () => {
		// 2026-03-07 23:00 → 2026-03-08 04:00 local (03:00 wall = 4 real hours after 23:00).
		const start = local(2026, 3, 7, 23, 0);
		const end = local(2026, 3, 8, 4, 0);
		const split = splitDurationByLocalDay(start, end);
		expect(split.get('2026-03-07')).toBe(ms(1));
		expect(split.get('2026-03-08')).toBe(end - start - ms(1));
		expect([...split.values()].reduce((a, b) => a + b)).toBe(end - start);
	});
});

describe('dailySummary', () => {
	it('a midnight-crossing sleep stays one entry but each day gets its share', () => {
		const e = sleep(local(2026, 8, 24, 23, 30), local(2026, 8, 25, 1, 30));
		const d24 = dailySummary([e], '2026-08-24', local(2026, 8, 25, 12, 0));
		const d25 = dailySummary([e], '2026-08-25', local(2026, 8, 25, 12, 0));
		expect(d24.sleep.totalMs).toBe(ms(0, 30));
		expect(d25.sleep.totalMs).toBe(ms(1, 30));
		// Counted once, on its start day.
		expect(d24.sleep.completedCount).toBe(1);
		expect(d25.sleep.completedCount).toBe(0);
	});

	it('open sleep contributes to total up to now but not to average', () => {
		const now = local(2026, 8, 24, 14, 0);
		const open = sleep(now - ms(1), null);
		const done = sleep(local(2026, 8, 24, 9, 0), local(2026, 8, 24, 10, 0));
		const d = dailySummary([open, done], '2026-08-24', now);
		expect(d.sleep.totalMs).toBe(ms(2));
		expect(d.sleep.completedCount).toBe(1);
		expect(d.sleep.averageMs).toBe(ms(1));
	});

	it('nursing splits left/right from segments; bottle/pump/diaper aggregate', () => {
		const start = local(2026, 8, 24, 9, 0);
		const nursing: EventDTO = {
			...sleep(start, start + ms(0, 30)), id: 'n1', type: 'nursing',
			details: { segments: [
				{ side: 'left', startedAt: new Date(start).toISOString(), endedAt: new Date(start + ms(0, 10)).toISOString() },
				{ side: 'right', startedAt: new Date(start + ms(0, 12)).toISOString(), endedAt: new Date(start + ms(0, 30)).toISOString() }
			] }
		};
		const bottle: EventDTO = { ...sleep(start, null), id: 'b1', type: 'bottle', endedAt: null, details: { milkType: 'formula', volumeMl: 90 } };
		const diaper: EventDTO = { ...sleep(start, null), id: 'd1', type: 'diaper', endedAt: null, details: { pee: true, poo: true } };
		const d = dailySummary([nursing, bottle, diaper], '2026-08-24', start + ms(1));
		expect(d.nursing).toEqual({ count: 1, totalMs: ms(0, 28), leftMs: ms(0, 10), rightMs: ms(0, 18) });
		expect(d.bottle).toEqual({ count: 1, totalMl: 90 });
		expect(d.diaper).toEqual({ count: 1, pee: 1, poo: 1 });
	});
});

describe('day helpers', () => {
	it('dayRangeIso spans local midnight to next local midnight', () => {
		const { from, to } = dayRangeIso('2026-11-01'); // 25-hour day
		expect(Date.parse(to) - Date.parse(from)).toBe(ms(25));
		expect(localDayKey(new Date(Date.parse(from)))).toBe('2026-11-01');
	});
});
```

- [ ] **Step 2:** `npx vitest run src/lib/client/summaries.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `summaries.ts`.** Core split:

```ts
export function splitDurationByLocalDay(startMs: number, endMs: number): Map<string, number> {
	const result = new Map<string, number>();
	let cursor = startMs;
	while (cursor < endMs) {
		const d = new Date(cursor);
		const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
		const sliceEnd = Math.min(endMs, nextMidnight);
		const key = localDayKey(d);
		result.set(key, (result.get(key) ?? 0) + (sliceEnd - cursor));
		cursor = sliceEnd;
	}
	return result;
}
```

`dailySummary`: filter events by type; counts keyed on `localDayKey(new Date(Date.parse(startedAt)))`; nursing durations from segments (each segment split by day, side buckets); sleep from `[startedAt, endedAt ?? nowMs]` split by day; averages guard division by zero. `weeklySummary` maps 7 day keys via date arithmetic (`new Date(y, m, d + i)`).

- [ ] **Step 4:** Tests PASS + `npm run check`.
- [ ] **Step 5: Commit** — `feat: add day-splitting summaries engine` (include this plan file in the first commit).

---

### Task 2: Server — overlap listing

**Files:**
- Modify: `src/lib/server/events/repo.ts` (`listEvents`), `src/routes/api/events/+server.ts` (query param), `docs/api/events-api.md` (document `overlap=1`)
- Test: `src/lib/server/events/repo.test.ts` (append)

**Interfaces:**
- Produces: `listEvents(db, { babyId, from?, to?, overlap? })` — with `overlap: true`, returns non-deleted events **overlapping** `[from, to)`: `started_at < to AND (ended_at IS Null with active treated as still running — i.e. `(ended_at IS NULL OR ended_at >= from)`) AND started_at-condition dropped`; default behavior unchanged (starts-in-window). Route: `overlap=1` toggles it.

- [ ] **Step 1: Failing tests** (append to `repo.test.ts`): a sleep 23:30→01:30 appears in the next day's overlap window but not in its starts-in window; an active (null-ended) event started before the window appears in overlap mode; default mode unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (SQL branch). **Step 4:** PASS + `npm run check`. 
- [ ] **Step 5: Commit** — `feat: list events overlapping a window`

---

### Task 3: Client plumbing — change relay and range fetches

**Files:**
- Modify: `src/lib/client/sync.svelte.ts` (`subscribeChanges`), `src/lib/client/api.ts` (`listEvents(babyId, from, to, overlap?)` helper)
- Test: `src/lib/client/sync.test.ts` (append)

**Interfaces:**
- Produces: `SyncStore.subscribeChanges(fn: (change: { kind: string; event: EventDTO }) => void): () => void` — relay invoked for every `sync` message AND once with `{ kind: 'reset' }`-style signal on `reset`/`snapshot` (so history refetches after reconnect/restore). Listener errors are swallowed; unsubscribe works; `stop()` clears listeners.

- [ ] **Step 1:** Failing unit tests: relay receives applied changes; unsubscribe stops it; snapshot/reset trigger a refetch signal.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (a `Set` of listeners invoked from the existing handlers — do not disturb the buffering/generation logic). **Step 4:** PASS + `npm run check`.
- [ ] **Step 5: Commit** — `feat: expose a change relay for non-today views`

---

### Task 4: History page — day view (selector, list, filters)

**Files:**
- Rewrite: `src/routes/history/+page.svelte` (stub → real)
- Create: `src/lib/components/history/DayPicker.svelte`, `src/lib/components/history/EventList.svelte`
- Test: `e2e/history.spec.ts`

**Interfaces:**
- Consumes: `getContext('sync')` store (baby id, relay), `api.listEvents(babyId, from, to, overlap=1)`, `dailySummary`, category tokens/icons (same lucide set as Today), `formatElapsed`.
- Produces:
  - `DayPicker`: « ◀ / date / ▶ » (48 px arrows), today by default, ▶ disabled on today; French date label (`Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' })`).
  - Filters: category chips (Alimentation / Couche / Sommeil), multi-toggle, color + icon (never color alone).
  - `EventList`: chronological (ascending) rows — time `HH:MM` `tabular-nums`, category icon + tinted dot, label (e.g. « Biberon · 90 ml », « Allaitement · 18 min · G+D », « Couche · Pipi », « Sommeil · 1 h 05 » — midnight-crossers show their full span with a « → lendemain » hint), caregiver color dot when set. Rows are buttons (≥ 48 px) opening the edit sheet (Task 6). Skeleton rows while loading > 300 ms; empty state French.
  - Day summary block above the list (from `dailySummary`): the FR-010 metrics, `tabular-nums`.
  - Data flow: fetch on day/filter change (overlap mode); `subscribeChanges` → refetch the current window (cheap, family-scale).

- [ ] **Step 1: Failing e2e** — `e2e/history.spec.ts` (main server; seed its own data via `request` first):

```ts
import { expect, test } from '@playwright/test';

test('day view lists events chronologically with summary; filters work', async ({ page, request }) => {
	const day = new Date(); day.setHours(9, 0, 0, 0);
	const mkIso = (h: number) => { const d = new Date(day); d.setHours(h); return d.toISOString(); };
	await request.post('/api/events', { data: { babyId: 'baby-1', type: 'diaper', startedAt: mkIso(9), details: { pee: true, poo: false } } });
	await request.post('/api/events', { data: { babyId: 'baby-1', type: 'bottle', startedAt: mkIso(11), details: { milkType: 'formula', volumeMl: 90 } } });

	await page.goto('/history');
	const rows = page.getByTestId('event-row');
	await expect(rows.first()).toContainText('Couche');
	await expect(page.getByTestId('day-summary')).toContainText('90');

	await page.getByRole('button', { name: 'Couche' }).click(); // filter chip → only diapers hidden? chips select categories
	// Chips: clicking « Sommeil » alone filters to sleep only → list empties of bottle/diaper rows.
	await page.getByRole('button', { name: 'Sommeil', exact: true }).click();
	await expect(page.getByTestId('event-row')).toHaveCount(0);
});

test('day picker navigates to yesterday (empty) and back', async ({ page }) => {
	await page.goto('/history');
	await page.getByRole('button', { name: 'Jour précédent' }).click();
	await expect(page.getByText(/aucune activité/i)).toBeVisible();
	await page.getByRole('button', { name: 'Jour suivant' }).click();
	await expect(page.getByTestId('event-row').first()).toBeVisible();
});
```

(Adjust the filter-chip interaction in the test to the implemented semantics — chips toggle categories on/off, all on by default — but keep the assertions' spirit: filtering hides other categories, day navigation works.)

- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + `npm run check`.
- [ ] **Step 5: Commit** — `feat: add history day view with summary and filters`

---

### Task 5: Timeline + week view (FR-009/FR-010)

**Files:**
- Create: `src/lib/components/history/DayTimeline.svelte`, `src/lib/components/history/WeekView.svelte`
- Modify: `src/routes/history/+page.svelte` (jour/semaine toggle)
- Test: extend `e2e/history.spec.ts`

**Interfaces:**
- Produces:
  - `DayTimeline`: horizontal 24 h band (SVG or flex), one lane per category, blocks positioned/sized by time using **local** hours; category tint + a distinguishing marker (icon above or pattern) so lanes read without color; point events as ticks. Accessible: `role="img"` + French `aria-label` summarizing the day.
  - Jour/Semaine segmented toggle (48 px).
  - `WeekView`: 7 columns Mon–Sun (`weeklySummary`), per-day stacked totals as bars with **direct labels** (value on/next to bar — design bans detached legends), plus an accessible text summary (`<figcaption>` or visually-hidden list). Tapping a column jumps to that day's day view. Discreet gridlines via border tokens. Data: one overlap fetch spanning the 7 days.
- [ ] **Step 1: Failing e2e additions:** toggle to « Semaine » shows 7 columns (`getByTestId('week-col')` count 7) with today's bottle total visible; clicking today's column returns to day view.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + `npm run check`. 
- [ ] **Step 5: Commit** — `feat: add day timeline and week view`

---

### Task 6: Editing, manual add, undoable delete (FR-006/FR-007)

**Files:**
- Create: `src/lib/components/history/EventEditSheet.svelte`, `src/lib/components/history/ManualAddSheet.svelte`
- Modify: `src/routes/history/+page.svelte` (wire row → edit; « Ajouter » button)
- Test: `e2e/history-edit.spec.ts`

**Interfaces:**
- Consumes: `api.patchEvent`/`deleteEvent`/`restoreEvent`/`createEvent` (add thin `patchEvent(id, patch)` helper to `api.ts` if missing), `UndoToast` queue from slice 3.
- Produces:
  - `EventEditSheet` (bottom sheet, design § Formulaires): edits per type — common: start `datetime-local`, note, caregiver select; sleep/pump/nursing: end `datetime-local`; bottle: type/volume; pump: side/volume; diaper: pee/poo toggles; nursing: per-segment side + times list (compact rows, editable times). Server 400 issues mapped to the right field in French; pending spinner; dirty-close confirmation. Every confirmed response merges into local state; the history list refetches via the relay.
  - Delete: « Supprimer » (danger token, icon + text) inside the sheet → `deleteEvent` → sheet closes → UndoToast 5 s « Entrée supprimée » with Annuler → `restoreEvent` (409 `timer_conflict` surfaced in French). List updates immediately (event vanishes) — the deletion itself was server-confirmed before the toast, so this respects FR-018.
  - `ManualAddSheet` (FR-006): type chooser (5 types) then the same per-type form as edit, times editable, defaults now; nursing manual entry = start + « minutes gauche » + « minutes droite » (`inputmode="numeric"`) building sequential segments left-then-right within the span; submit → `createEvent` (completed events; timer types require an end — set from start + durations).
- [ ] **Step 1: Failing e2e** — `e2e/history-edit.spec.ts`: manual-add a bottle yesterday (navigate to yesterday, « Ajouter », Biberon, volume 120, save) → row appears with « 120 »; edit it to 150 → row shows 150; delete it → row gone, toast « Annuler » → row back; delete again and let the toast expire → row gone after reload.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + `npm run check`.
- [ ] **Step 5: Commit** — `feat: add event editing, manual entry and undoable delete`

---

### Task 7: Today integration, design pass, docs, full verification

**Files:**
- Modify: `src/lib/components/today/SummaryCard.svelte` (switch to `dailySummary` — one source of truth for FR-010), `CLAUDE.md` (architecture bullet), `docs/api/events-api.md` (verify `overlap` documented)
- Test: `e2e/today-a11y.spec.ts` (add `/history` at 320/390/768 + dark), unit suite green

- [ ] **Step 1:** SummaryCard consumes `dailySummary(store.events, todayKey, store.nowMs)`; remove its ad-hoc math; keep its display contract (unit tests if any exist for it).
- [ ] **Step 2:** Design checklist pass on all new components (tokens, 48 px, `tabular-nums`, focus rings, `motion-reduce`, dark mode, no detached legends); extend `today-a11y.spec.ts` to `/history` (no horizontal scroll at 320/390/768, dark body not pure white).
- [ ] **Step 3:** Update `CLAUDE.md` (history components + summaries engine + overlap param).
- [ ] **Step 4: Full verification** — `npm run check && npm run test:unit && npm run test:e2e` all green.
- [ ] **Step 5: Commit** — `feat: unify daily summaries and finish history design pass`

---

## Self-review notes (already applied)

- FR-006 → Task 6 ManualAddSheet; FR-007 → Task 6 edit/delete/undo; FR-009 → Tasks 4–5; FR-010/AC-006 → Task 1 (midnight + both DST directions, TZ pinned in-test) with the server overlap support of Task 2 making cross-midnight events visible.
- Counts vs durations rule (count on start day, duration split by day) is stated explicitly in Task 1 so day and week totals stay coherent.
- No schema change; the only server delta is a read-mode option.
- The e2e specs create their own events; per-file independence maintained under `workers: 1`; no active timers left behind (none started).
