# Slice 6 — Hardening, Full E2E and v0.1.0 Release — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the acceptance-criteria gaps (notably AC-003 multi-device sync), make the CI-verifiable NFRs actually verified (NFR-006 no third-party requests, NFR-008 token discipline), audit FR-018 end to end, and leave the repo release-ready so the orchestrator can tag `v0.1.0` (the tag itself is NOT part of this PR — the orchestrator tags after merge).

**Architecture:** No new features. Gap-filling e2e specs, a static NFR-008 guard test, targeted FR-018 fixes only where the audit finds violations, and a release-readiness check of `Dockerfile`/`release.yml`/`deploy/docker-compose.yml`/`README`.

**Tech Stack:** existing stack; Playwright (two browser contexts for AC-003), Vitest.

**Spec:** `docs/specs/2026-08-23-newborn-tracker-spec.md` (FR-018; AC-003, AC-011; NFR-001/005/006/008). ADR 0002 (release/deploy). Out of scope per the map: real-device Safari/Chrome testing, actual Pi deployment (AC-012 stays manual).

## Global Constraints

- `npm ci --ignore-scripts` first; `--ignore-scripts` always.
- Code/commits English, UI French, conventional commits, NO AI attribution, no session links.
- e2e: prod build, chromium, workers 1, two servers (3000 seeded, 3001 empty) — leave both clean, no active timers left behind.
- Fix only what the audits reveal — no opportunistic refactoring (this is the last slice before the tag).
- Verification: `npm run check && npm run test:unit && npm run test:e2e`.

---

### Task 1: AC-003 — multi-device sleep sync e2e

**Files:**
- Create: `e2e/multi-device.spec.ts`

- [ ] **Step 1: Write the spec** (it should pass against current code — this is a gap in coverage, not necessarily in behavior; if it FAILS, diagnose with superpowers:systematic-debugging before touching app code):

```ts
import { expect, test } from '@playwright/test';

test('AC-003: sleep started on device A is visible and stoppable on device B; A sees the end in < 2 s', async ({ browser, request }) => {
	const ctxA = await browser.newContext();
	const ctxB = await browser.newContext();
	const pageA = await ctxA.newPage();
	const pageB = await ctxB.newPage();

	await pageA.goto('/');
	await pageA.getByRole('button', { name: 'Commencer le sommeil' }).click();
	await expect(pageA.getByTestId('active-timers')).toContainText('Sommeil');

	// Device B opens the app and sees the running timer (server state, not local).
	await pageB.goto('/');
	await expect(pageB.getByTestId('active-timers')).toContainText('Sommeil');

	// B stops it; A must see the end within the NFR-001 budget (2 s).
	await pageB.getByRole('button', { name: 'Réveillé' }).click();
	await expect(pageA.getByTestId('active-timers')).toBeHidden({ timeout: 2000 });

	await ctxA.close();
	await ctxB.close();
	const { timers } = await (await request.get('/api/timers?babyId=baby-1')).json();
	expect(timers).toHaveLength(0);
});
```

- [ ] **Step 2:** Run it (`npx playwright test e2e/multi-device.spec.ts`). Expected: PASS. If it fails, root-cause first (SSE propagation is the suspect area), fix minimally, rerun.
- [ ] **Step 3: Commit** — `test: cover multi-device sleep sync (AC-003)`

---

### Task 2: NFR-006 — zero third-party requests, verified

**Files:**
- Create: `e2e/no-third-party.spec.ts`

- [ ] **Step 1: Write the spec:** for each of `/`, `/history`, `/settings`: collect every request URL via `page.on('request')`, navigate, wait for `networkidle`, interact lightly (open the bottle sheet on `/`, switch to Semaine on `/history`), then assert every URL's host is `localhost:3000` (or `data:`/`blob:` schemes). Fonts must be self-hosted, so any `fonts.googleapis.com`/CDN hit fails the test.
- [ ] **Step 2:** Run. Expected PASS (fonts are @fontsource). If any external host appears, fix the source (never allowlist it).
- [ ] **Step 3: Commit** — `test: enforce zero third-party requests (NFR-006)`

---

### Task 3: NFR-008 — static token-discipline guard

**Files:**
- Create: `src/lib/design-guard.test.ts`

- [ ] **Step 1: Write a Vitest test** that globs `src/**/*.svelte` (use `fs`/`path`, no new deps) and fails on: hex color literals (`#[0-9a-fA-F]{3,8}\b` outside CSS custom-property definitions), `bg-black`/`bg-white`/`text-black`/`text-white` utility classes, and inline `box-shadow:`/`backdrop-filter: blur`. Allowlist (explicit constant in the test, one line each with a reason): `src/lib/palette.ts` consumers using `style="--dot-color: {c}"` patterns fed from the palette (caregiver colors are data, not design tokens) — inspect actual hits and either fix the component or justify the allowlist entry in a comment.
- [ ] **Step 2:** Run; fix every unjustified hit (tokens instead). Expected end state: PASS with an allowlist of ≤ a handful of justified entries.
- [ ] **Step 3: Commit** — `test: guard design-token discipline statically (NFR-008)`

---

### Task 4: FR-018 audit — failed writes keep the form, with Réessayer

**Files:**
- Audit: every write surface (`BottleSheet`, `PumpSheet` stop, `ManualAddSheet`, `EventEditSheet`, `/setup`, `/settings` sections, `/pin`)
- Create: `e2e/fr018-retry.spec.ts`; fix only revealed violations.

- [ ] **Step 1: Audit** each surface against FR-018's three clauses: (a) failure keeps the user's input; (b) an explicit retry is possible (re-submit with kept values counts — a dismissed sheet that loses input does not); (c) nothing renders as saved before the server confirms. Note findings in the PR body.
- [ ] **Step 2: Write the spec** — `e2e/fr018-retry.spec.ts`: with `page.route` failing `POST /api/events` once (503), submit a bottle (90 ml): assert a French error appears, the sheet stays open, the volume still reads 90; un-route; resubmit; assert success toast and the event exists via `request.get('/api/events?...')`. Same pattern for one settings write (caregiver add).
- [ ] **Step 3:** Run; fix violations found in Steps 1–2 (minimal diffs). 
- [ ] **Step 4: Commit** — `test: verify failed writes keep input and retry (FR-018)` (+ separate `fix:` commits if the audit found violations)

---

### Task 5: Release readiness

**Files:**
- Verify (modify only if broken): `Dockerfile`, `.github/workflows/release.yml`, `deploy/docker-compose.yml`, `README.md`

- [ ] **Step 1:** `docker build -t swaddle:local .` succeeds locally; `docker run --rm -p 3999:3000 -e DATA_DIR=/app/data swaddle:local` responds on `GET /api/health` (then stop it).
- [ ] **Step 2:** Read `release.yml` end to end: tag trigger `v*.*.*`, buildx multi-arch `linux/amd64,linux/arm64`, GHCR login, tags include the version and `latest`? Confirm the image name matches `deploy/docker-compose.yml` (`ghcr.io/macroman5/swaddle:v0.1.0`). Fix inconsistencies only.
- [ ] **Step 3:** README pass: quick-start section (compose pull & up, first-launch wizard, PIN reset pointer to `docs/runbooks/pin-reset.md`, backup/restore pointer) — French, concise; write it if missing.
- [ ] **Step 4: Commit** — `docs: release readiness pass for v0.1.0` (or `fix:` for workflow corrections)

---

### Task 6: Full verification + PR

- [ ] **Step 1:** `npm run check && npm run test:unit && npm run test:e2e` all green.
- [ ] **Step 2:** Push and open the PR (title `feat: hardening and full e2e for v0.1.0 (slice 6)`, body: AC/NFR coverage table — which AC is covered where — FR-018 audit findings, release-readiness notes, `Part of #7, resolves the work of #13`). The orchestrator merges and then tags `v0.1.0`.

---

## Self-review notes (already applied)

- AC coverage after this slice: AC-001/002/004/005/007/008/009/010 already covered (slices 2–5), AC-003 → Task 1, AC-006 unit-covered, AC-011 partially (320/390/768 + dark via `today-a11y.spec.ts`; real devices out of scope per map), AC-012 manual post-release.
- The tag/GHCR verification belongs to the orchestrator after merge — the PR must not create tags.
- No feature work: any behavior change must trace to a Task 1/2/3/4 finding.
