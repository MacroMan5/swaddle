import { expect, test } from '@playwright/test';
// Relative import: $lib aliases do not resolve in Playwright test files (see
// global-setup.ts).
import { APP_DESCRIPTION, pageTitle } from '../../src/lib/meta';
import { BASE_B } from './ports';

const B = BASE_B;

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
