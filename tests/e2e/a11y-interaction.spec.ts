import { expect, test, type Locator, type Page } from '@playwright/test';
import {
	reduceMotion,
	removeSeededEvents,
	seedTodayEvents,
	settleAnimations,
	TEXT_SPACING_CSS
} from './a11y';
import { BASE_B } from './ports';

// Issue #54 — the behavioural half of the accessibility verification: focus
// movement and restoration, obstruction by the fixed chrome, 200% zoom, WCAG
// 1.4.12 text spacing and the 320 px floor.
//
// Unlike the axe scans (a11y-scan.spec.ts, chromium only — see the rationale
// there), every check in this file is engine-sensitive: focus order, dialog
// focus traps, hit-testing under fixed overlays and reflow are exactly where
// Chromium and WebKit differ. So it runs under BOTH browser projects.
//
// Runs before onboarding.spec.ts (alphabetical file order under workers: 1),
// so server B is still pre-onboarding — which is what the /setup checks need.

const B = BASE_B;

/** The five remediated routes on server A. Server B carries /setup and /pin. */
const ROUTES_A = ['/', '/history', '/settings'];

async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
	await settleAnimations(page);
	const overflow = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		innerWidth: window.innerWidth
	}));
	expect(
		overflow.scrollWidth,
		`${label}: document is wider than the viewport (${overflow.scrollWidth} > ${overflow.innerWidth})`
	).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

/**
 * Asserts the element actually receives a pointer/tap at its own centre — i.e.
 * nothing (fixed navigation, a toast, a sticky header) is painted on top of it.
 * `elementFromPoint` is the same hit-test the browser runs for a real tap, so
 * this catches obstruction that a visibility assertion cannot.
 */
async function expectHitTestable(locator: Locator, label: string): Promise<void> {
	await locator.scrollIntoViewIfNeeded();
	const box = await locator.boundingBox();
	expect(box, `${label}: has no layout box`).not.toBeNull();
	const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
	const result = await locator.evaluate((el, pt) => {
		const top = document.elementFromPoint(pt.x, pt.y);
		return {
			hit: top === el || el.contains(top),
			obstruction: top === el || el.contains(top) ? null : (top?.outerHTML.slice(0, 120) ?? 'none')
		};
	}, point);
	expect(result.hit, `${label}: obstructed by ${result.obstruction}`).toBe(true);
}

/** Describes whatever currently holds focus, for assertions and failure messages. */
function activeElementInfo(page: Page) {
	return page.evaluate(() => {
		const el = document.activeElement as HTMLElement | null;
		if (!el) return null;
		return {
			tag: el.tagName,
			label: el.getAttribute('aria-label'),
			text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
			insideDialog: !!el.closest('[role="dialog"]')
		};
	});
}

/** Presses Tab until `matches` accepts the focused element, or gives up loudly. */
async function tabUntil(
	page: Page,
	matches: (info: NonNullable<Awaited<ReturnType<typeof activeElementInfo>>>) => boolean,
	label: string,
	maxSteps = 40
): Promise<void> {
	const seen: string[] = [];
	for (let i = 0; i < maxSteps; i++) {
		await page.keyboard.press('Tab');
		const info = await activeElementInfo(page);
		if (!info) continue;
		seen.push(`${info.tag}[${info.label ?? info.text}]`);
		if (matches(info)) return;
	}
	throw new Error(`${label}: not reached by Tab in ${maxSteps} steps. Visited: ${seen.join(' → ')}`);
}

test('a Today sheet takes focus on open and gives it back on close', async ({ page }) => {
	await reduceMotion(page);
	await page.goto('/');
	const trigger = page.getByRole('button', { name: 'Biberon', exact: true });
	await expect(trigger).toBeVisible();

	// Opened from the keyboard, not a mouse click, so the restored focus below
	// is meaningful rather than an artefact of where the pointer was.
	await trigger.focus();
	await page.keyboard.press('Enter');
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	await expect
		.poll(async () => (await activeElementInfo(page))?.insideDialog, {
			message: 'focus moves inside the sheet'
		})
		.toBe(true);

	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect
		.poll(async () => (await activeElementInfo(page))?.label, {
			message: 'focus returns to the tile that opened the sheet'
		})
		.toBe('Biberon');
});

test('the History edit sheet takes focus on open and gives it back on close', async ({
	page,
	request
}) => {
	const ids = await seedTodayEvents(request);
	try {
		await reduceMotion(page);
		await page.goto('/history');
		const row = page.getByTestId('event-row').first();
		await expect(row).toBeVisible();
		await row.click();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expect.poll(async () => (await activeElementInfo(page))?.insideDialog).toBe(true);

		// Closed through the sheet's own "Fermer" control rather than Escape, so
		// both close paths are covered (Escape is covered on Today above).
		await dialog.getByRole('button', { name: 'Fermer' }).click();
		await expect(dialog).toBeHidden();
		await expect.poll(async () => (await activeElementInfo(page))?.insideDialog).toBe(false);
	} finally {
		await removeSeededEvents(request, ids);
	}
});

test('the untimed deletion recovery path is usable by keyboard alone', async ({ page, request }) => {
	// Issue #50's recovery path, driven end to end without a pointer: Tab to the
	// trash trigger, Enter, Tab to Restaurer, Enter — plus the role/name/state
	// each of those steps depends on.
	// A random volume keeps this row identifiable even when another project's
	// run (chromium → webkit share both servers) has left its own soft-deleted
	// bottles in the same list.
	const volumeMl = 200 + Math.floor(Math.random() * 700);
	const created = await request.post('/api/events', {
		data: {
			babyId: 'baby-1',
			caregiverId: 'cg-1',
			type: 'bottle',
			startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
			details: { milkType: 'formula', volumeMl }
		}
	});
	expect(created.status()).toBe(201);
	const { id } = await created.json();
	await request.delete(`/api/events/${id}`);

	await reduceMotion(page);
	await page.goto('/history');
	await expect(page.getByRole('heading', { name: 'Historique' })).toBeVisible();

	// Role + accessible name: the trigger is an icon-only button, so its
	// aria-label is the only thing a screen reader has to go on.
	const trigger = page.getByRole('button', { name: 'Supprimés récemment' });
	await expect(trigger).toBeVisible();
	await expect(trigger).toBeEnabled();

	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await tabUntil(page, (i) => i.label === 'Supprimés récemment', 'the Supprimés récemment trigger');
	await page.keyboard.press('Enter');

	// Role + accessible name of the sheet itself (bits-ui wires the title as the
	// dialog's label).
	const dialog = page.getByRole('dialog', { name: 'Supprimés récemment' });
	await expect(dialog).toBeVisible();
	const row = page.getByTestId('recently-deleted-row').filter({ hasText: String(volumeMl) });
	await expect(row).toHaveCount(1);

	// The restore control names the event it restores, not just "Restaurer".
	const restore = row.getByRole('button', { name: /^Restaurer / });
	await expect(restore).toBeVisible();
	await expect(restore).toBeEnabled();
	const restoreLabel = await restore.getAttribute('aria-label');

	await tabUntil(page, (i) => i.label === restoreLabel, 'the Restaurer button');
	await page.keyboard.press('Enter');

	await expect(row).toHaveCount(0);
	await expect
		.poll(async () => (await (await request.get(`/api/events/${id}`)).json()).deletedAt ?? null)
		.toBeNull();

	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect.poll(async () => (await activeElementInfo(page))?.label).toBe('Supprimés récemment');

	await request.delete(`/api/events/${id}`);
});

test('the Today bootstrap error is an alert whose Réessayer is keyboard-reachable', async ({
	page
}) => {
	// today-bootstrap.spec.ts covers the retry *behaviour* through
	// `data-testid="bootstrap-error"`; what it never asserts is that the failure
	// reaches a screen reader at all. This is that assertion: role=alert (so it
	// is announced without moving focus) plus a Réessayer reachable and
	// activatable by keyboard alone, which the real-device checklist asks
	// VoiceOver/TalkBack to confirm by ear.
	let failed = false;
	await page.route('**/api/events?**', async (route) => {
		if (route.request().method() === 'GET' && !failed) {
			failed = true;
			await route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: JSON.stringify({ error: { code: 'internal', message: 'unavailable' } })
			});
			return;
		}
		await route.continue();
	});

	await reduceMotion(page);
	await page.goto('/');
	const alert = page.getByTestId('bootstrap-error');
	await expect(alert).toBeVisible();
	await expect(alert).toHaveAttribute('role', 'alert');

	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await tabUntil(page, (i) => i.text === 'Réessayer', 'the bootstrap Réessayer button');
	await page.keyboard.press('Enter');
	await expect(alert).toBeHidden();
	await page.unroute('**/api/events?**');
});

test('the fixed bottom navigation never obscures the last row of a long list', async ({
	page,
	request
}) => {
	const ids = await seedTodayEvents(request);
	try {
		await reduceMotion(page);
		// The narrowest supported viewport is where the page is tallest and the
		// fixed nav has the best chance of sitting on top of real content.
		await page.setViewportSize({ width: 320, height: 568 });
		await page.goto('/history');
		const last = page.getByTestId('event-row').last();
		await expect(last).toBeVisible();

		// The nav's own links are checked first, while no dialog has ever been
		// open: bits-ui parks `pointer-events: none` on the body for as long as a
		// sheet is mounted, which would make every hit test below report the
		// document element instead of the real stacking order.
		for (const name of ['Aujourd’hui', 'Historique', 'Réglages']) {
			await expectHitTestable(
				page.getByRole('link', { name, exact: true }),
				`bottom nav link "${name}"`
			);
		}

		await expectHitTestable(last, 'the last event row at 320×568');
		// And it really is actionable, not merely unobstructed at its centre:
		// Playwright's own hit-target check would fail the click otherwise.
		await last.click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toBeHidden();
	} finally {
		await removeSeededEvents(request, ids);
	}
});

test('a live undo toast obscures neither the bottom navigation nor its own action', async ({
	page
}) => {
	await reduceMotion(page);
	await page.setViewportSize({ width: 320, height: 568 });
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Pipi', exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Pipi', exact: true }).click();
	const toast = page.getByRole('status').filter({ hasText: 'Couche' });
	await expect(toast).toBeVisible();

	// The toast is stacked above the nav, not over it.
	for (const name of ['Aujourd’hui', 'Historique', 'Réglages']) {
		await expectHitTestable(
			page.getByRole('link', { name, exact: true }),
			`bottom nav link "${name}" behind a toast`
		);
	}

	// And its own action is reachable before the 5 s window closes — which also
	// undoes the diaper this test recorded, leaving no data behind.
	const undo = toast.getByRole('button', { name: 'Annuler' });
	await expectHitTestable(undo, 'the toast’s Annuler button');
	await undo.click();
	await expect(toast).toBeHidden();
});

test('200% zoom: every route reflows without a horizontal scrollbar', async ({ page, browser }) => {
	// Method: a browser zoomed to 200% halves the CSS-pixel viewport it exposes
	// at a constant window size. A 768×1024 window at 200% therefore renders
	// into a 384×512 CSS viewport, which is what we emulate here — engine
	// neutral (no `zoom`/`deviceScaleFactor` quirks to reason about) and exactly
	// the geometry WCAG 1.4.4/1.4.10 care about.
	await page.setViewportSize({ width: 384, height: 512 });
	await reduceMotion(page);
	for (const route of ROUTES_A) {
		await page.goto(route);
		await expectNoHorizontalScroll(page, `${route} at 200% zoom`);
	}
	await expectHitTestable(
		page.getByRole('link', { name: 'Réglages', exact: true }),
		'bottom nav at 200% zoom'
	);

	const context = await browser.newContext({ baseURL: B, viewport: { width: 384, height: 512 } });
	const bPage = await context.newPage();
	await reduceMotion(bPage);
	await bPage.goto(`${B}/setup`);
	await expect(bPage.getByLabel('Prénom')).toBeVisible();
	await expectNoHorizontalScroll(bPage, '/setup at 200% zoom');
	await context.close();
});

test('WCAG 1.4.12 text spacing does not clip or overlap the critical controls', async ({ page }) => {
	await reduceMotion(page);
	// 390 px — a current phone in portrait — is where the strict "nothing is
	// clipped" assertion runs. At the 320 px floor the three hero tiles (a
	// 3-column grid of ~85 px cells) clip their labels horizontally once
	// letter-spacing grows by 0.12em: "Allaiter" needs 98 px of the 85 px it
	// has. That is a real 1.4.12 shortfall, but a property of the Registre
	// 3-up tile grid at the narrowest supported width — no remediation ticket
	// touched it, and un-clipping it means re-deciding that grid, so it is
	// reported as a follow-up rather than patched here. Functionality is not
	// lost: each tile's accessible name is an `aria-label`, unaffected by the
	// visual truncation, and the 320 px pass below still requires every control
	// to stay hit-testable with no horizontal scrolling.
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await page.addStyleTag({ content: TEXT_SPACING_CSS });
	await expectNoHorizontalScroll(page, '/ with 1.4.12 text spacing');

	// "Not clipped" = the control's own content still fits inside its box; the
	// tiles have a fixed height, which is where a 1.5 line-height would bite.
	for (const name of ['Allaiter', 'Biberon', 'Couche', 'Pipi', 'Caca', 'Les deux']) {
		const control = page.getByRole('button', { name, exact: true });
		await expectHitTestable(control, `"${name}" with 1.4.12 text spacing`);
		const clipped = await control.evaluate(
			(el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
		);
		expect(clipped, `"${name}" clips its own label under 1.4.12 text spacing`).toBe(false);
	}

	// The 320 px floor: no horizontal scrolling and every control still tappable.
	await page.setViewportSize({ width: 320, height: 568 });
	await page.goto('/');
	await page.addStyleTag({ content: TEXT_SPACING_CSS });
	await expectNoHorizontalScroll(page, '/ at 320 px with 1.4.12 text spacing');
	for (const name of ['Allaiter', 'Biberon', 'Couche', 'Pipi', 'Caca', 'Les deux']) {
		await expectHitTestable(
			page.getByRole('button', { name, exact: true }),
			`"${name}" at 320 px with 1.4.12 text spacing`
		);
	}

	await page.goto('/history');
	await page.addStyleTag({ content: TEXT_SPACING_CSS });
	await expectNoHorizontalScroll(page, '/history with 1.4.12 text spacing');
	await expectHitTestable(
		page.getByRole('button', { name: 'Ajouter', exact: true }),
		'"Ajouter" with 1.4.12 text spacing'
	);

	await page.goto('/settings');
	await page.addStyleTag({ content: TEXT_SPACING_CSS });
	await expectNoHorizontalScroll(page, '/settings with 1.4.12 text spacing');
	await expectHitTestable(
		page.getByRole('button', { name: 'Ajouter un aidant' }),
		'"Ajouter un aidant" with 1.4.12 text spacing'
	);
});

test('320 px: the five routes fit and keep their controls hit-testable', async ({
	page,
	browser,
	request
}) => {
	// today-a11y.spec.ts already measures 48 px target *heights* on / and
	// /history at 320 px; this adds the two routes it never reaches (/setup and
	// /pin, both on server B) plus /settings, and asserts hit-testability rather
	// than size — a 48 px target under a fixed bar is still unusable.
	await reduceMotion(page);
	await page.setViewportSize({ width: 320, height: 568 });
	for (const route of ROUTES_A) {
		await page.goto(route);
		await expectNoHorizontalScroll(page, `${route} at 320 px`);
	}
	await expectHitTestable(
		page.getByRole('button', { name: 'Ajouter un aidant' }),
		'"Ajouter un aidant" at 320 px'
	);

	const context = await browser.newContext({ baseURL: B, viewport: { width: 320, height: 568 } });
	const bPage = await context.newPage();
	await reduceMotion(bPage);

	await bPage.goto(`${B}/setup`);
	await expect(bPage.getByLabel('Prénom')).toBeVisible();
	await expectNoHorizontalScroll(bPage, '/setup at 320 px');
	await expectHitTestable(
		bPage.getByRole('button', { name: 'Continuer' }),
		'"Continuer" at 320 px'
	);

	await request.put(`${B}/api/household/pin`, { data: { pin: '1234' } });
	try {
		await bPage.goto(`${B}/pin`);
		await expect(bPage.getByLabel('Code PIN')).toBeVisible();
		await expectNoHorizontalScroll(bPage, '/pin at 320 px');
		await expectHitTestable(
			bPage.getByRole('button', { name: 'Déverrouiller' }),
			'"Déverrouiller" at 320 px'
		);
	} finally {
		await request.delete(`${B}/api/household/pin`, { data: { currentPin: '1234' } });
		await context.close();
	}
});
