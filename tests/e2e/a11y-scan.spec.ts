import { expect, test } from '@playwright/test';
import {
	expectNoSeriousViolations,
	forceDarkTheme,
	reduceMotion,
	removeSeededEvents,
	seedTodayEvents
} from './a11y';
import { BASE_B } from './ports';

// Issue #54 — automated semantic accessibility scans (axe-core, WCAG 2.1 A/AA)
// over the five remediated routes in representative states.
//
// Chromium only, on purpose. axe evaluates the DOM and the *computed*
// accessibility tree, both of which this app builds identically in either
// engine (no engine-specific markup, no UA-sniffing) — so replaying the same
// rule set under WebKit would roughly double the suite's slowest specs to
// re-derive the same verdict. What genuinely differs between engines is
// behaviour: focus order and restoration, obstruction, zoom/text-spacing
// reflow, small-viewport layout. Those all live in a11y-interaction.spec.ts,
// which runs under BOTH projects.
//
// Runs before onboarding.spec.ts (alphabetical file order under workers: 1),
// so server B is still pre-onboarding here — which is exactly the state the
// /setup scan needs. The /pin scan installs and removes its own pin, the same
// enable/disable-around-the-test pattern head-metadata.spec.ts uses.
test.skip(
	({ browserName }) => browserName !== 'chromium',
	'axe scans the DOM, which is engine-independent; behaviour is covered in a11y-interaction.spec.ts under both engines.'
);

const B = BASE_B;

const ACTIVE_TILE = 'button[aria-label="Sommeil en cours"]';

test('Today: events, an active timer and an open sheet (light)', async ({ page, request }) => {
	const ids = await seedTodayEvents(request);
	const started = await request.post('/api/timers/sleep/start', { data: { babyId: 'baby-1' } });
	expect(started.status()).toBe(201);
	try {
		await reduceMotion(page);
		await page.goto('/');
		await expect(page.getByTestId('active-timers')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Biberon', exact: true })).toBeVisible();
		// The running control is scanned like any other node: its de-emphasis
		// now fades decoration only, so its "En cours" label keeps the contrast
		// of the control it sits on (issue #85).
		await expect(page.locator(ACTIVE_TILE)).toBeVisible();
		await expectNoSeriousViolations(page, 'Today · events + active timer · light');

		await page.getByRole('button', { name: 'Biberon', exact: true }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await expectNoSeriousViolations(page, 'Today · bottle sheet open · light');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toBeHidden();
	} finally {
		await request.post('/api/timers/sleep/stop', { data: { babyId: 'baby-1' } });
		await removeSeededEvents(request, ids);
	}
});

test('History: day view, the edit sheet and Recently deleted (light)', async ({ page, request }) => {
	const ids = await seedTodayEvents(request);
	// One of them is deleted up front so "Supprimés récemment" is scanned with a
	// row (and its Restaurer button) rather than in its empty state.
	await request.delete(`/api/events/${ids[2]}`);
	try {
		await reduceMotion(page);
		await page.goto('/history');
		await expect(page.getByRole('heading', { name: 'Historique' })).toBeVisible();
		await expect(page.getByTestId('event-row').first()).toBeVisible();
		await expectNoSeriousViolations(page, 'History · day view with events · light');

		await page.getByTestId('event-row').first().click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await expectNoSeriousViolations(page, 'History · edit sheet open · light');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toBeHidden();

		await page.getByRole('button', { name: 'Supprimés récemment' }).click();
		await expect(page.getByTestId('recently-deleted-row').first()).toBeVisible();
		await expectNoSeriousViolations(page, 'History · Recently deleted sheet open · light');
		await page.keyboard.press('Escape');
	} finally {
		await removeSeededEvents(request, [ids[0], ids[1]]);
	}
});

test('Settings: caregivers listed and a visible error state (light)', async ({ page }) => {
	await reduceMotion(page);
	await page.goto('/settings');
	// The seeded caregiver (global-setup.ts) is the "with a caregiver" state.
	await expect(page.getByRole('list').getByText('Parent')).toBeVisible();

	// A failing theme save is the cheapest way to a *visible* error state that
	// is part of this remediation (issue #52's alert + aria-describedby wiring);
	// settings.spec.ts asserts the semantics, this asserts nothing else broke.
	await page.route('**/api/household', async (route) => {
		if (route.request().method() === 'PATCH') {
			await route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: '{"error":{"code":"internal_error","message":"boom"}}'
			});
			return;
		}
		await route.continue();
	});
	await page.getByRole('button', { name: 'Sombre' }).click();
	await expect(page.getByRole('alert').filter({ hasText: 'Une erreur est survenue.' })).toBeVisible();

	await expectNoSeriousViolations(page, 'Settings · caregiver + error state · light');
	await page.unroute('**/api/household');
});

test('Today and Settings scan clean in the dark theme', async ({ page, request }) => {
	// The palette swap is the only thing dark mode changes, so it is scanned
	// once over the two most control-dense screens (contrast rules are where a
	// theme regression would show) rather than over every route.
	const ids = await seedTodayEvents(request);
	try {
		await forceDarkTheme(page);
		await reduceMotion(page);
		await page.goto('/');
		await expect(page.locator('html')).toHaveClass(/dark/);
		await expect(page.getByRole('button', { name: 'Biberon', exact: true })).toBeVisible();
		await expectNoSeriousViolations(page, 'Today · events · dark');

		await page.goto('/settings');
		await expect(page.locator('html')).toHaveClass(/dark/);
		await expect(page.getByRole('list').getByText('Parent')).toBeVisible();
		await expectNoSeriousViolations(page, 'Settings · dark');
	} finally {
		await removeSeededEvents(request, ids);
	}
});

test('Setup step 1 (server B, empty install)', async ({ browser }) => {
	const context = await browser.newContext({ baseURL: B });
	const page = await context.newPage();
	await reduceMotion(page);
	await page.goto(`${B}/setup`);
	await expect(page.getByLabel('Prénom')).toBeVisible();
	await expectNoSeriousViolations(page, 'Setup · step 1 · light');
	await context.close();
});

test('PIN gate (server B, pin enabled)', async ({ browser, request }) => {
	await request.put(`${B}/api/household/pin`, { data: { pin: '1234' } });
	try {
		const context = await browser.newContext({ baseURL: B });
		const page = await context.newPage();
		await reduceMotion(page);
		await page.goto(`${B}/pin`);
		await expect(page.getByLabel('Code PIN')).toBeVisible();
		await expectNoSeriousViolations(page, 'PIN gate · light');
		await context.close();
	} finally {
		await request.delete(`${B}/api/household/pin`, { data: { currentPin: '1234' } });
	}
});
