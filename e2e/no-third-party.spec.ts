import { expect, test } from '@playwright/test';

// NFR-006: the app must never phone home. Every request the page issues while
// loading and during light interaction must stay on the local origin (or use
// a data:/blob: scheme for inlined assets) — no CDNs, no third-party fonts,
// no analytics.
function assertLocalOnly(urls: string[]) {
	for (const url of urls) {
		if (url.startsWith('data:') || url.startsWith('blob:')) continue;
		const host = new URL(url).host;
		expect(host, `unexpected third-party request: ${url}`).toBe('localhost:3000');
	}
}

test('/ makes no third-party requests, including opening the bottle sheet', async ({ page }) => {
	const urls: string[] = [];
	page.on('request', (req) => urls.push(req.url()));

	await page.goto('/');
	await page.waitForLoadState('networkidle');

	await page.getByRole('button', { name: 'Biberon' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.waitForLoadState('networkidle');

	assertLocalOnly(urls);
});

test('/history makes no third-party requests, including switching to Semaine', async ({
	page
}) => {
	const urls: string[] = [];
	page.on('request', (req) => urls.push(req.url()));

	await page.goto('/history');
	await page.waitForLoadState('networkidle');

	await page.getByRole('button', { name: 'Semaine', exact: true }).click();
	await page.waitForLoadState('networkidle');

	assertLocalOnly(urls);
});

test('/settings makes no third-party requests', async ({ page }) => {
	const urls: string[] = [];
	page.on('request', (req) => urls.push(req.url()));

	await page.goto('/settings');
	await page.waitForLoadState('networkidle');

	assertLocalOnly(urls);
});
