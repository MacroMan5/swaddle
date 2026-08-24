# Slice 5 — Settings, Onboarding, PIN and Exports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First-launch wizard (FR-016), full settings (FR-011), optional family PIN with a persistent per-device session (FR-015), CSV + versioned JSON exports, SQLite snapshot download, and JSON restore with an automatic pre-restore snapshot (FR-014).

**Architecture:** Server first: new repo/API modules for household, caregivers, baby creation, auth and export/restore, on top of the slice-2 layer (`src/lib/server/events/`, `src/lib/server/api.ts` — reuse `apiError`/`handleRepoError`/`readJson`). A `hooks.server.ts` gate handles both redirects (setup incomplete → `/setup`; PIN enabled without session → `/pin`). UI: `/setup`, `/pin`, `/settings` pages following `docs/design/design-system.md` (tokens only, ≥ 48 px, French copy).

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), better-sqlite3, zod v4 (already a dep), Node `crypto.scrypt`, Vitest, Playwright.

**Spec:** `docs/specs/2026-08-23-newborn-tracker-spec.md` (FR-011, FR-014, FR-015, FR-016, FR-017; AC-007, AC-008, AC-009; DEC-003; RISK-002). API conventions: `docs/api/events-api.md`.

## Global Constraints

- Installs: **always** `npm ci --ignore-scripts` first (node_modules absent in this worktree); `--ignore-scripts` on any install.
- Code, identifiers, comments, commit messages in **English**; UI copy in **French**; no AI attribution anywhere (no Co-Authored-By, no Claude/AI/generated mentions, no session links).
- Error envelope everywhere: `{ error: { code, message, issues? } }` via `apiError`; JSON bodies through `readJson`.
- Timestamps ISO 8601 UTC. Tokens-only styling, targets ≥ 48 px (NFR-008/005).
- Snapshots use SQLite's `VACUUM INTO` — never a hot file copy (RISK-002).
- **Parallel-slice boundary:** slice 3 (running concurrently) owns `src/routes/+page.svelte`, `+layout.svelte`, `/history`, `src/lib/components/today/`, `src/lib/client/`. This slice owns `/setup`, `/pin`, `/settings`, `hooks.server.ts`, `/api/household|caregivers|auth|export|backup|restore`, `POST /api/babies` — and WRITES the `swaddle.caregiverId` localStorage key (slice 3 reads it). Do not touch slice-3 files; if `main` moves, merge `origin/main` and resolve (package.json/lock: keep both, rerun install).
- Verification: `npm run check`, `npm run test:unit`, `npm run test:e2e`.

## Contracts produced (summary)

| Route | Verb | Purpose |
|---|---|---|
| `/api/babies` | POST | create baby `{name, birthdate, timezone?}` → 201 BabyDTO |
| `/api/caregivers` | GET / POST | list / create `{name, color}` → CaregiverDTO |
| `/api/caregivers/[id]` | PATCH / DELETE | rename/recolor / delete (refused with 409 `in_use` if referenced by events) |
| `/api/household` | GET / PATCH | `{volumeUnit, theme, pinEnabled}` / update unit & theme |
| `/api/household/pin` | PUT / DELETE | set-or-change PIN `{pin, currentPin?}` / disable `{currentPin}` |
| `/api/auth/pin` | POST | verify `{pin}` → sets session cookie |
| `/api/export/json` | GET | versioned full export (v1) |
| `/api/export/csv` | GET | flat events CSV |
| `/api/backup` | GET | consistent SQLite snapshot download (`VACUUM INTO`) |
| `/api/restore` | POST | JSON-export body → wipe+reimport, after an automatic `VACUUM INTO` snapshot of the current db |

PIN session: cookie `swaddle_session` = hex HMAC-SHA256 of `'swaddle-session-v1'` keyed by the stored `pin_hash`; `httpOnly`, `sameSite:'lax'`, `path:'/'`, maxAge 1 year (DEC-003 long-lived per-device). Changing or disabling the PIN rotates/clears `pin_hash`, which invalidates every existing cookie. PIN hash = `scrypt(pin, random 16-byte salt)` stored as `salt:hash` hex in `household.pin_hash`. Reset without the PIN = documented server-side procedure (SQL nulling `pin_hash`), in `docs/runbooks/pin-reset.md`.

Household row: singleton `id=1`, created lazily on first read (`ensureHousehold`), defaults `volume_unit='ml'`, `theme='auto'`.

---

### Task 1: Household + caregiver + baby repo layer

**Files:**
- Create: `src/lib/server/settings/repo.ts`
- Test: `src/lib/server/settings/repo.test.ts`

**Interfaces:**
- Consumes: schema v1 tables (`household`, `baby`, `caregiver`, `event`), `RepoError` from `$lib/server/events/repo` (reuse — do not redefine), `listBabies` stays in events/repo.
- Produces:
  - `type HouseholdDTO = { volumeUnit: 'ml' | 'oz'; theme: 'light' | 'dark' | 'auto'; pinEnabled: boolean }`
  - `type CaregiverDTO = { id: string; name: string; color: string }`
  - `ensureHousehold(db): void` (INSERT OR IGNORE id=1); `getHousehold(db): HouseholdDTO`; `updateHousehold(db, patch: { volumeUnit?; theme? }): HouseholdDTO`
  - `createBaby(db, { name, birthdate, timezone }): BabyDTO`; `listCaregivers(db): CaregiverDTO[]`; `createCaregiver(db, { name, color }): CaregiverDTO`; `updateCaregiver(db, id, patch): CaregiverDTO` (`not_found`); `deleteCaregiver(db, id): void` (`not_found`; `RepoError('in_use', …)` — add `'in_use'` to the RepoError code union — when an event references it)
  - `getPinHash(db): string | null`; `setPinHash(db, hash: string | null): void`

- [ ] **Step 1: Write failing tests** — `repo.test.ts` with an in-memory db (`openDb(':memory:')`): household lazily created with defaults; update unit/theme persists; `pinEnabled` reflects `pin_hash`; baby created and listed via existing `listBabies`; caregiver CRUD; deleting a caregiver referenced by an event throws `in_use` while an unreferenced one deletes.
- [ ] **Step 2:** Run → FAIL (module not found).
- [ ] **Step 3: Implement** exactly the Interfaces list (plain prepared statements, `randomUUID()` ids, `created_at = new Date().toISOString()`).
- [ ] **Step 4:** `npx vitest run src/lib/server/settings/repo.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat: add household, baby and caregiver repository`

---### Task 2: PIN hashing and session tokens

**Files:**
- Create: `src/lib/server/settings/auth.ts`
- Test: `src/lib/server/settings/auth.test.ts`

**Interfaces:**
- Produces:
  - `hashPin(pin: string): string` — `salt:hash` hex via `crypto.scryptSync(pin, salt, 32)` with a random 16-byte salt
  - `verifyPin(pin: string, stored: string): boolean` — constant-time compare (`crypto.timingSafeEqual`)
  - `sessionToken(pinHash: string): string` — `createHmac('sha256', pinHash).update('swaddle-session-v1').digest('hex')`
  - `isValidSession(cookie: string | undefined, pinHash: string | null): boolean` — true when no PIN is set; otherwise timing-safe equality with `sessionToken(pinHash)`
  - `SESSION_COOKIE = 'swaddle_session'`; `PIN_SCHEMA` = zod `z.string().regex(/^\d{4,8}$/)` (4–8 digits)

- [ ] **Step 1: Failing tests:** hash/verify round-trip; wrong pin false; two hashes of the same pin differ (salt); session token valid, invalidated after `setPinHash` to a new hash; `isValidSession(undefined, null)` true (no PIN → open).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS. 
- [ ] **Step 5: Commit** — `feat: add pin hashing and stateless device sessions`

---

### Task 3: Export / restore engine

**Files:**
- Create: `src/lib/server/settings/transfer.ts`
- Test: `src/lib/server/settings/transfer.test.ts`

**Interfaces:**
- Produces:
  - `exportJson(db): SwaddleExport` — `{ format: 'swaddle-export', version: 1, exportedAt, household: {volumeUnit, theme}, babies: BabyDTO[], caregivers: CaregiverDTO[], events: EventDTO[] }` — events INCLUDE soft-deleted rows (`deletedAt` kept) so a restore is lossless.
  - `exportCsv(db): string` — header `id,babyId,caregiverId,type,startedAt,endedAt,note,details,createdAt,updatedAt,deletedAt`; RFC 4180 quoting (`"` doubled, fields containing `,"\n` quoted); details as JSON string.
  - `importJson(db, data: unknown): { babies: number; caregivers: number; events: number }` — zod-validate the envelope (`format`, `version === 1`), then in ONE transaction: delete `event`, `caregiver`, `baby`, household row, re-insert everything preserving ids and timestamps. Throws `RepoError('validation_failed', …)` on a bad payload (nothing written).
  - `snapshotTo(db, destPath: string): void` — `db.prepare('VACUUM INTO ?').run(destPath)` after `mkdirSync(dirname, {recursive:true})` (RISK-002: never a file copy).

- [ ] **Step 1: Failing tests (the ticket's required integration cycle, AC-007):** seed db A (baby, caregiver, one diaper + one completed nursing + one soft-deleted bottle) → `exportJson(A)` → `importJson(B /* fresh :memory: */, parsed)` → `exportJson(B)` deep-equals `exportJson(A)` minus `exportedAt`; `importJson` on garbage throws and leaves B's existing rows untouched; `exportCsv` quotes a note containing `a,"b"\n`; `snapshotTo` writes a file that `openDb` can reopen with identical event count (use a tmpdir, not `:memory:`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat: add versioned export, csv and transactional json restore`

---

### Task 4: HTTP routes — settings domain

**Files:**
- Create: `src/routes/api/babies/+server.ts` → ADD `POST` next to the existing `GET` (modify, don't recreate)
- Create: `src/routes/api/caregivers/+server.ts`, `src/routes/api/caregivers/[id]/+server.ts`
- Create: `src/routes/api/household/+server.ts`, `src/routes/api/household/pin/+server.ts`, `src/routes/api/auth/pin/+server.ts`
- Create: `src/routes/api/export/json/+server.ts`, `src/routes/api/export/csv/+server.ts`, `src/routes/api/backup/+server.ts`, `src/routes/api/restore/+server.ts`
- Test: `e2e/api-settings.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–3, `apiError`/`handleRepoError`/`readJson` from `$lib/server/api`, `getDb`.
- Produces (route behaviors):
  - `POST /api/babies` `{name (1–100 chars), birthdate (YYYY-MM-DD, not future), timezone?}` (default server TZ `Intl.DateTimeFormat().resolvedOptions().timeZone`) → 201.
  - Caregivers: POST `{name 1–100, color: /^#[0-9a-fA-F]{6}$/}`; PATCH partial; DELETE → 204, `in_use` → 409.
  - `GET /api/household` → HouseholdDTO (after `ensureHousehold`); `PATCH` `{volumeUnit?, theme?}` zod-validated.
  - `PUT /api/household/pin` `{pin, currentPin?}` — if a PIN exists, `currentPin` must verify (else 403 `forbidden`); stores new hash AND sets a fresh session cookie (the device that sets the PIN stays signed in). `DELETE` `{currentPin}` — verifies then nulls the hash and clears the cookie.
  - `POST /api/auth/pin` `{pin}` → verify or 403 `forbidden`; on success set `SESSION_COOKIE` (settings in the plan header) → `{ ok: true }`.
  - `GET /api/export/json` → `content-disposition: attachment; filename="swaddle-export-<date>.json"`. CSV likewise (`text/csv; charset=utf-8`).
  - `GET /api/backup` → `snapshotTo` into `DATA_DIR/backups/backup-<ISO date, colons stripped>.sqlite`, then `new Response(readFileSync(path))` with `application/octet-stream` + attachment filename.
  - `POST /api/restore` → body via `readJson`; FIRST `snapshotTo(db, DATA_DIR/backups/pre-restore-<stamp>.sqlite)` (FR-014 automatic snapshot), THEN `importJson` → `{ restored: {babies, caregivers, events}, snapshot: '<path>' }`.
- [ ] **Step 1: Failing e2e** — `e2e/api-settings.spec.ts` (runs against the MAIN seeded server; it must leave the seed intact for other specs — the restore test re-imports the export it just made, restoring the exact same state):

```ts
import { expect, test } from '@playwright/test';

test('household defaults, patch, caregiver CRUD', async ({ request }) => {
	const before = await (await request.get('/api/household')).json();
	expect(before).toMatchObject({ volumeUnit: 'ml', theme: 'auto', pinEnabled: false });
	const patched = await request.patch('/api/household', { data: { theme: 'dark' } });
	expect((await patched.json()).theme).toBe('dark');
	await request.patch('/api/household', { data: { theme: 'auto' } }); // restore

	const created = await request.post('/api/caregivers', { data: { name: 'Papa', color: '#0284C7' } });
	expect(created.status()).toBe(201);
	const { id } = await created.json();
	const renamed = await request.patch(`/api/caregivers/${id}`, { data: { name: 'Papou' } });
	expect((await renamed.json()).name).toBe('Papou');
	expect((await request.delete(`/api/caregivers/${id}`)).status()).toBe(204);
});

test('caregiver referenced by an event cannot be deleted', async ({ request }) => {
	const res = await request.delete('/api/caregivers/cg-1'); // seeded, referenced by earlier api specs' events
	// cg-1 may or may not be referenced depending on spec order — create our own referenced caregiver instead:
	const cg = await (await request.post('/api/caregivers', { data: { name: 'Ref', color: '#112233' } })).json();
	await request.post('/api/events', {
		data: { babyId: 'baby-1', caregiverId: cg.id, type: 'diaper', startedAt: new Date().toISOString(), details: { pee: true, poo: false } }
	});
	const del = await request.delete(`/api/caregivers/${cg.id}`);
	expect(del.status()).toBe(409);
	expect((await del.json()).error.code).toBe('in_use');
	void res;
});

test('AC-007: export json → restore reproduces the data and leaves a snapshot', async ({ request }) => {
	const exported = await (await request.get('/api/export/json')).json();
	expect(exported).toMatchObject({ format: 'swaddle-export', version: 1 });
	const restore = await request.post('/api/restore', { data: exported });
	expect(restore.ok()).toBeTruthy();
	const body = await restore.json();
	expect(body.restored.events).toBe(exported.events.length);
	expect(body.snapshot).toContain('pre-restore');
	const after = await (await request.get('/api/export/json')).json();
	expect(after.events).toEqual(exported.events);
	expect(after.babies).toEqual(exported.babies);
});

test('csv export has a header and one line per event', async ({ request }) => {
	const res = await request.get('/api/export/csv');
	expect(res.headers()['content-type']).toContain('text/csv');
	const lines = (await res.text()).trim().split('\n');
	expect(lines[0]).toContain('id,babyId');
	const { events } = await (await request.get('/api/events?babyId=baby-1')).json();
	expect(lines.length).toBeGreaterThanOrEqual(1 + events.length);
});

test('backup downloads a sqlite snapshot', async ({ request }) => {
	const res = await request.get('/api/backup');
	expect(res.status()).toBe(200);
	expect((await res.body()).subarray(0, 15).toString()).toContain('SQLite format 3');
});
```

- [ ] **Step 2:** Run → FAIL (404s). **Step 3:** Implement the routes (thin: zod parse via local schemas, repo/transfer calls, `handleRepoError`). **Step 4:** `npm run check` + this spec PASS.
- [ ] **Step 5: Commit** — `feat: add settings, auth, export and restore HTTP API`

---

### Task 5: Server hooks — setup and PIN gates

**Files:**
- Create: `src/hooks.server.ts`
- Test: covered by Task 6/7 e2e (second server, below); unit-test the pure decision function.
- Create: `src/lib/server/settings/gate.ts` + `gate.test.ts`

**Interfaces:**
- Produces: `gateDecision(opts: { pathname: string; setupComplete: boolean; pinHash: string | null; sessionCookie: string | undefined }): 'ok' | 'to-setup' | 'to-pin'` — pure, unit-testable:
  - always `'ok'` for `/api/auth/pin`, `/api/health`, `/_app/`, `/favicon`;
  - `'to-setup'` when setup incomplete and pathname is neither `/setup` nor an `/api/` route needed by the wizard (`/api/babies`, `/api/caregivers`, `/api/household`);
  - `'to-pin'` when a PIN is set, `isValidSession` fails, and pathname is not `/pin` (APIs included — FR-015/DEC-003: the PIN protects the whole app; API callers without a session get 401 `pin_required` instead of a redirect);
  - `'ok'` otherwise.
  `hooks.server.ts` maps: pages → 303 redirect to `/setup` or `/pin`; `/api/*` → 401 `{error:{code:'pin_required'}}` (setup gate never blocks `/api/*` writes — the e2e seed path and slice-3 flows must keep working).
- [ ] **Step 1:** Failing unit tests on `gateDecision` for each branch (incl. « setup incomplete but path=/setup → ok », « pin ok via cookie → ok », « API without session → to-pin »).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `gate.ts` + `hooks.server.ts` (read `pinHash`/`isSetupComplete` per request — SQLite reads are microseconds; no caching to go stale). **Step 4:** PASS + `npm run check`.
- [ ] **Step 5: Commit** — `feat: gate the app behind setup completion and optional pin`

---

### Task 6: Onboarding wizard `/setup` (FR-016, AC-008) — second Playwright server

**Files:**
- Create: `src/routes/setup/+page.svelte`
- Modify: `playwright.config.ts` (second webServer, port 3001, empty `DATA_DIR: '.playwright-data-empty'`), `e2e/global-setup.ts` (also `rmSync('.playwright-data-empty')`)
- Test: `e2e/onboarding.spec.ts`

**Interfaces:**
- Produces: two-step wizard, tokens-only styling, one card centered: step 1 « Votre bébé » (name input labeled « Prénom », date input labeled « Date de naissance », button « Continuer » ≥ 48 px) → step 2 « Qui s'en occupe ? » (name + color chips from a fixed 8-color token-friendly palette, button « Terminer ») → on success: writes the created caregiver id to `localStorage['swaddle.caregiverId']` (contract consumed by slice 3) → `goto('/')`. Server 400 issues shown under fields. Playwright `webServer` becomes an array: existing seeded server (3000) + `{ command: 'node build', port: 3001, env: { DATA_DIR: '.playwright-data-empty', PORT: '3001' }, reuseExistingServer: false }` (single build reused — keep `npm run build &&` only on the first entry).
- [ ] **Step 1: Failing e2e** — `e2e/onboarding.spec.ts` (targets `http://localhost:3001` explicitly via `page.goto('http://localhost:3001/')`):

```ts
import { expect, test } from '@playwright/test';

const B = 'http://localhost:3001';

test('AC-008: empty db redirects to the wizard; baby + caregiver make the app usable', async ({ page }) => {
	await page.goto(`${B}/`);
	await expect(page).toHaveURL(`${B}/setup`);
	await page.getByLabel('Prénom').fill('Léa');
	await page.getByLabel('Date de naissance').fill('2026-08-01');
	await page.getByRole('button', { name: 'Continuer' }).click();
	await page.getByLabel('Prénom').fill('Camille');
	await page.getByRole('button', { name: 'Terminer' }).click();
	await expect(page).toHaveURL(`${B}/`);
	const caregiverId = await page.evaluate(() => localStorage.getItem('swaddle.caregiverId'));
	expect(caregiverId).toBeTruthy();
	const health = await page.request.get(`${B}/api/health`);
	expect((await health.json()).setupComplete).toBe(true);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement wizard + config. **Step 4:** spec PASS (and the OTHER specs still pass — run the full `npm run test:e2e` once here). 
- [ ] **Step 5: Commit** — `feat: add first-launch wizard on a dedicated e2e server`

---

### Task 7: `/pin` page + settings PIN section (FR-015, AC-009)

**Files:**
- Create: `src/routes/pin/+page.svelte`
- Test: `e2e/pin.spec.ts` (server B, AFTER onboarding spec — name it `e2e/pin.spec.ts` and rely on alphabetical file order `onboarding` < `pin` under workers:1; assert setup is complete at the top as a guard)

**Interfaces:**
- Produces: `/pin` — one centered card, label « Code PIN », `input inputmode="numeric" autocomplete="current-password" type="password"`, button « Déverrouiller » ≥ 48 px; wrong PIN shows « Code incorrect » under the field; success → `goto('/')`. PIN enable/change/disable UI itself lives in the settings page (Task 8) but the API is live since Task 4, so the e2e drives enabling via API.
- [ ] **Step 1: Failing e2e** — `e2e/pin.spec.ts`: `request.put('${B}/api/household/pin', {data:{pin:'1234'}})` (server B request via `playwright.request.newContext({ baseURL: B })`); new **browser context** (no cookies) → `goto(B)` → redirected to `/pin`; wrong pin `9999` → error text, still on `/pin`; right pin → lands on `/`; reload → stays on `/` (persistent session, AC-009); finally disable the PIN (`request.delete` with `currentPin: '1234'` using a context that has the cookie — use the page's `page.request` after unlocking) so server B ends unlocked.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + full e2e still green.
- [ ] **Step 5: Commit** — `feat: add pin unlock page with persistent device session`

---

### Task 8: Settings page `/settings` (FR-011)

**Files:**
- Create: `src/routes/settings/+page.svelte` (+ small section components in `src/routes/settings/` if it grows past ~250 lines)
- Create: `docs/runbooks/pin-reset.md`
- Test: `e2e/settings.spec.ts` (main server, port 3000)

**Interfaces:**
- Produces: sections as stacked cards (Card component), French labels, ≥ 48 px controls:
  1. **Bébé** — name + birthdate edit? No PATCH baby endpoint exists and FR-011 only requires display+entry: implement name/birthdate as read-only display this slice (editing = out of MVP settings scope; note it in the PR).
  2. **Aidants** — list with color dot, add (name + color chips), rename, delete (409 `in_use` surfaced as « Impossible : des activités y sont liées »).
  3. **Cet appareil** — radio list of caregivers; choice stored in `localStorage['swaddle.caregiverId']` (« Qui utilise cet appareil ? »).
  4. **Unité** — segmented ml / oz → PATCH household.
  5. **Thème** — Clair / Sombre / Auto → PATCH household + apply immediately: `document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches))` and persist `localStorage['swaddle.theme']`; add a tiny inline script in `src/app.html` `<head>` reading that key and setting the class before paint (no flash, design § Mode sombre).
  6. **Code PIN** — enable (two matching 4–8 digit inputs), change (current + new), disable (current) → the Task 4 endpoints; state from `household.pinEnabled`.
  7. **Données** — buttons « Exporter JSON », « Exporter CSV », « Télécharger une sauvegarde » (plain `<a href download>`), « Restaurer » (file input accepting `.json` → parse → confirm dialog « Cette action remplace toutes les données… » → POST `/api/restore` → success toast with counts).
  `docs/runbooks/pin-reset.md`: the documented server-side reset (stop container, `sqlite3 data/swaddle.db "UPDATE household SET pin_hash = NULL"`, restart) — in French.
- [ ] **Step 1: Failing e2e** — `e2e/settings.spec.ts` (main server): navigate `/settings`; add caregiver « Mamie » with a color; select her under « Cet appareil » and assert localStorage; switch unit to oz and back (assert PATCH via re-GET); switch theme to Sombre → `<html>` has class `dark` → back to Auto; assert the four export/restore controls are visible.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + `npm run check`.
- [ ] **Step 5: Commit** — `feat: add settings page covering caregivers, device, unit, theme, pin and data`

---

### Task 9: Docs + full verification

**Files:**
- Modify: `docs/api/events-api.md` → add a linked sibling `docs/api/settings-api.md` (French narrative, the route table + shapes as implemented), `CLAUDE.md` (Architecture: `src/lib/server/settings/`, hooks, routes)

- [ ] **Step 1:** Write `docs/api/settings-api.md` from the code (verify each route, don't copy the plan blindly); link it from `events-api.md`'s header; update `CLAUDE.md`.
- [ ] **Step 2: Full verification** — `npm run check && npm run test:unit && npm run test:e2e` all green.
- [ ] **Step 3: Commit** — `docs: document the settings API and pin reset runbook`

---

## Self-review notes (already applied)

- FR-011 sections map 1:1 to Task 8; FR-014 = Tasks 3/4 (+auto snapshot inside `/api/restore`); FR-015 = Tasks 2/5/7 (+DEC-003 long session, documented reset); FR-016 = Task 6; AC-007 has both an integration test (Task 3) and an e2e (Task 4); AC-008/AC-009 have dedicated e2e on the empty second server.
- Scope decision to carry into the PR description: restore accepts the **JSON export** (what AC-007 tests); restoring a raw SQLite snapshot is a documented manual operation (file swap in `DATA_DIR`), not an upload endpoint — keeps the risky db-file-replacement path out of the web surface.
- The setup gate never blocks `/api/*` so the seeded main server and slice-3 flows are unaffected; the PIN gate does block APIs (FR-015 « protège l'ensemble de l'application ») but no PIN is ever left enabled on either e2e server.
