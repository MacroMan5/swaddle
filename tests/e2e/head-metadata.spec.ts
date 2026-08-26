import { expect, test, type Page } from '@playwright/test';
// Relative import: $lib aliases do not resolve in Playwright test files (see
// global-setup.ts).
import { APP_DESCRIPTION, THEME_COLOR_DARK, pageTitle } from '../../src/lib/meta';
import { BASE_B } from './ports';

const B = BASE_B;

// Mirrors the browser's own theme-color selection algorithm: the first
// <meta name="theme-color"> whose `media` matches wins (an unconditioned
// meta, like the forced-theme override, always matches).
function activeThemeColor(page: Page): Promise<string | null> {
	return page.evaluate(() => {
		const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
		const active = metas.find((m) => {
			const media = m.getAttribute('media');
			return !media || window.matchMedia(media).matches;
		});
		return active?.getAttribute('content') ?? null;
	});
}

// Issue #51: every user-facing route gets a distinct, descriptive title
// ending in "Swaddle", plus shared description/theme-color/apple-touch-icon
// metadata from a single source of truth ($lib/meta.ts).

test('/ has a descriptive title', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveTitle(pageTitle('Aujourd’hui'));
});

test('/history has a descriptive title', async ({ page }) => {
	await page.goto('/history');
	await expect(page).toHaveTitle(pageTitle('Historique'));
});

test('/settings has a descriptive title', async ({ page }) => {
	await page.goto('/settings');
	await expect(page).toHaveTitle(pageTitle('Réglages'));
});

test('/setup (server B, empty install) has a descriptive title', async ({ browser }) => {
	const context = await browser.newContext({ baseURL: B });
	const page = await context.newPage();

	await page.goto(`${B}/setup`);
	await expect(page).toHaveTitle(pageTitle('Configuration'));

	await context.close();
});

test('/pin (server B) has a descriptive title', async ({ browser, request }) => {
	// Same enable/disable-around-the-test pattern as pin.spec.ts and
	// no-third-party.spec.ts: /pin only renders directly once a pin is set.
	await request.put(`${B}/api/household/pin`, { data: { pin: '1234' } });
	try {
		const context = await browser.newContext({ baseURL: B });
		const page = await context.newPage();

		await page.goto(`${B}/pin`);
		await expect(page).toHaveTitle(pageTitle('Code PIN'));

		await context.close();
	} finally {
		await request.delete(`${B}/api/household/pin`, { data: { currentPin: '1234' } });
	}
});

test('an unknown route renders the error page with a descriptive title', async ({ page }) => {
	const res = await page.goto('/does-not-exist');
	expect(res?.status()).toBe(404);
	await expect(page).toHaveTitle(pageTitle('Erreur'));
	await expect(page.getByText('404')).toBeVisible();
});

test('shared metadata (description, theme-color, apple-touch-icon) is present', async ({
	page
}) => {
	await page.goto('/');

	await expect(page.locator('meta[name="description"]')).toHaveAttribute(
		'content',
		APP_DESCRIPTION
	);
	await expect(
		page.locator('meta[name="theme-color"][media="(prefers-color-scheme: light)"]')
	).toHaveCount(1);
	await expect(
		page.locator('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]')
	).toHaveCount(1);
	await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
		'href',
		/\/apple-touch-icon\.png$/
	);

	const iconRes = await page.request.get('/apple-touch-icon.png');
	expect(iconRes.ok()).toBeTruthy();
});

test('forcing a theme overrides the active theme-color, immediately and after a reload', async ({
	page
}) => {
	await page.goto('/settings');
	try {
		// Immediate: the settings page applies the forced color at runtime
		// (src/lib/client/themeColor.ts), without waiting for a reload.
		await page.getByRole('button', { name: 'Sombre' }).click();
		await expect(page.locator('html')).toHaveClass(/dark/);
		expect(await activeThemeColor(page)).toBe(THEME_COLOR_DARK);

		// Wait for the save to persist before reloading: reloading mid-PATCH
		// aborts the fetch, whose rollback path reverts the stored theme — the
		// post-reload color then depends on whatever household state earlier
		// specs left behind (the source of a recurring order-dependent flake).
		await expect
			.poll(async () => (await (await page.request.get('/api/household')).json()).theme)
			.toBe('dark');
		// The poll above proves the SERVER persisted — not that the page's own
		// PATCH fetch resolved. Reloading in that gap still aborts the response
		// in flight and runs the rollback, which strips the stored theme from
		// localStorage during unload while the server stays dark (#73's shape,
		// seen twice on CI on 2026-08-26). The sr-only confirmation is written
		// strictly after the fetch resolved, so waiting for it closes the gap.
		await expect(page.getByText('Thème mis à jour : Sombre.')).toBeAttached();

		// Survives a reload: the inline bootstrap in app.html applies the same
		// override before paint, so a stored forced theme never flashes the
		// OS-tracked color first.
		await page.reload();
		expect(await activeThemeColor(page)).toBe(THEME_COLOR_DARK);
	} finally {
		await page.getByRole('button', { name: 'Auto' }).click();
		// Same persistence wait for the cleanup, so test teardown can't abort
		// it and leak a forced theme into later specs.
		await expect
			.poll(async () => (await (await page.request.get('/api/household')).json()).theme)
			.toBe('auto');
		// Same fetch-resolution wait as above, so teardown can't abort the
		// cleanup PATCH and leak the forced theme through localStorage.
		await expect(page.getByText('Thème mis à jour : Auto.')).toBeAttached();
	}
});
