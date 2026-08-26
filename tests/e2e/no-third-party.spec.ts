import { expect, test } from '@playwright/test';

import { BASE_B, HOST_A, HOST_B } from './ports';

const B = BASE_B;

// NFR-006: the app must never phone home. Every request — and every
// WebSocket connection, in case one is ever added alongside SSE — the page
// issues while loading and during light interaction must stay on a local
// origin (or use a data:/blob: scheme for inlined assets): no CDNs, no
// third-party fonts, no analytics.
function assertLocalOnly(urls: string[], allowedHosts: string[]) {
	for (const url of urls) {
		if (url.startsWith('data:') || url.startsWith('blob:')) continue;
		const host = new URL(url).host;
		expect(allowedHosts, `unexpected third-party request: ${url}`).toContain(host);
	}
}

// Collecting on the BrowserContext (not the Page) also catches requests from
// any extra tab/popup/service-worker the interaction might open, not just
// the initial page.
function trackContext(context: import('@playwright/test').BrowserContext, allowedHosts: string[]) {
	const urls: string[] = [];
	context.on('request', (req) => urls.push(req.url()));
	context.on('websocket', (ws) => urls.push(ws.url()));
	return () => assertLocalOnly(urls, allowedHosts);
}

test('/ makes no third-party requests, including opening the bottle sheet', async ({
	page,
	context
}) => {
	const check = trackContext(context, [HOST_A]);

	await page.goto('/');
	await page.waitForLoadState('networkidle');

	await page.getByRole('button', { name: 'Biberon' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.waitForLoadState('networkidle');

	check();
});

test('/history makes no third-party requests, including switching to Semaine', async ({
	page,
	context
}) => {
	const check = trackContext(context, [HOST_A]);

	await page.goto('/history');
	await page.waitForLoadState('networkidle');

	await page.getByRole('button', { name: 'Semaine', exact: true }).click();
	await page.waitForLoadState('networkidle');

	check();
});

test('/settings makes no third-party requests', async ({ page, context }) => {
	const check = trackContext(context, [HOST_A]);

	await page.goto('/settings');
	await page.waitForLoadState('networkidle');

	check();
});

test('/setup (server B, empty install) makes no third-party requests', async ({
	browser
}) => {
	const context = await browser.newContext({ baseURL: B });
	const check = trackContext(context, [HOST_B]);
	const page = await context.newPage();

	await page.goto(`${B}/setup`);
	await page.waitForLoadState('networkidle');

	check();
	await context.close();
});

test('/pin (server B) makes no third-party requests', async ({ browser, request }) => {
	// /pin only renders directly (instead of redirecting to /setup) once a pin
	// is set — same enable/disable-around-the-test pattern as pin.spec.ts, so
	// server B is left as onboarding.spec.ts / pin.spec.ts expect it.
	await request.put(`${B}/api/household/pin`, { data: { pin: '1234' } });
	try {
		const context = await browser.newContext({ baseURL: B });
		const check = trackContext(context, [HOST_B]);
		const page = await context.newPage();

		await page.goto(`${B}/pin`);
		await page.waitForLoadState('networkidle');

		check();
		await context.close();
	} finally {
		await request.delete(`${B}/api/household/pin`, { data: { currentPin: '1234' } });
	}
});
