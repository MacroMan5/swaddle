import { expect, test, type APIResponse } from '@playwright/test';

const B = 'http://localhost:3001';

// Issue #55: every response the app produces carries the same-origin
// defenses, and the private ones are non-cacheable. The CSP itself only
// lands on HTML (SvelteKit's `csp` config); the rest comes from the handle
// hook, so it must also be on JSON, SSE and downloads.

function expectBaseHeaders(headers: Record<string, string>) {
	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['referrer-policy']).toBe('same-origin');
	expect(headers['x-frame-options']).toBe('DENY');
	expect(headers['cross-origin-opener-policy']).toBe('same-origin');
	expect(headers['cross-origin-resource-policy']).toBe('same-origin');
}

function expectStrictCsp(csp: string | undefined) {
	expect(csp, 'pages must carry a CSP').toBeTruthy();
	// Scripts: same-origin plus the per-request nonce SvelteKit mints — never
	// 'unsafe-inline' (which browsers would ignore next to a nonce anyway).
	expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
	expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
	expect(csp).toContain("default-src 'self'");
	expect(csp).toContain("frame-ancestors 'none'");
	expect(csp).toContain("object-src 'none'");
	expect(csp).toContain("base-uri 'self'");
	expect(csp).toContain("form-action 'self'");
	expect(csp).toContain("connect-src 'self'");
}

function expectNonCacheable(res: APIResponse) {
	expect(res.headers()['cache-control']).toBe('no-store');
}

test('public health response carries the headers and is non-cacheable', async ({ request }) => {
	const res = await request.get('/api/health');
	expect(res.ok()).toBeTruthy();
	expectBaseHeaders(res.headers());
	expectNonCacheable(res);
});

test('pages carry a strict same-origin CSP', async ({ request }) => {
	for (const path of ['/', '/history', '/settings']) {
		const res = await request.get(path);
		expect(res.ok()).toBeTruthy();
		expectBaseHeaders(res.headers());
		expectStrictCsp(res.headers()['content-security-policy']);
		expectNonCacheable(res);
	}
});

test('the gated pages of a fresh install carry them too', async ({ request }) => {
	const res = await request.get(`${B}/setup`);
	expect(res.ok()).toBeTruthy();
	expectBaseHeaders(res.headers());
	expectStrictCsp(res.headers()['content-security-policy']);
	expectNonCacheable(res);
});

test('the locked-out API envelope carries them (pin gate)', async ({ request }) => {
	// Same enable/disable-around-the-test pattern as pin.spec.ts, so server B
	// is left as the other specs expect it.
	await request.put(`${B}/api/household/pin`, { data: { pin: '1234' } });
	try {
		// Bare fetch, not the `request` fixture: setting the pin signs that
		// fixture's cookie jar in, so it would never see the locked envelope.
		const res = await fetch(`${B}/api/events?babyId=baby-1`);
		expect(res.status).toBe(401);
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('referrer-policy')).toBe('same-origin');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('cache-control')).toBe('no-store');
	} finally {
		await request.delete(`${B}/api/household/pin`, { data: { currentPin: '1234' } });
	}
});

test('event JSON is non-cacheable', async ({ request }) => {
	const res = await request.get('/api/events?babyId=baby-1');
	expect(res.ok()).toBeTruthy();
	expectBaseHeaders(res.headers());
	expectNonCacheable(res);
});

test('exports and backups stay downloadable and non-cacheable', async ({ request }) => {
	for (const path of ['/api/export/json', '/api/export/csv', '/api/backup']) {
		const res = await request.get(path);
		expect(res.ok()).toBeTruthy();
		expect(res.headers()['content-disposition']).toContain('attachment');
		expectBaseHeaders(res.headers());
		expectNonCacheable(res);
	}
});

test('downloads reach the browser under CSP (link and blob paths)', async ({ page }) => {
	await page.goto('/settings');

	const exported = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Exporter JSON' }).click();
	expect((await exported).suggestedFilename()).toContain('swaddle-export');

	// The backup goes through fetch + a blob: object URL, the path CSP is most
	// likely to break.
	const backup = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Télécharger une sauvegarde' }).click();
	expect((await backup).suggestedFilename()).toContain('backup');
});

test('SSE still connects and keeps its own cache policy', async ({ baseURL }) => {
	// The Playwright request fixture buffers responses; use Node fetch to stream.
	const res = await fetch(`${baseURL}/api/stream`, { headers: { accept: 'text/event-stream' } });
	expect(res.headers.get('content-type')).toContain('text/event-stream');
	expect(res.headers.get('x-content-type-options')).toBe('nosniff');
	expect(res.headers.get('referrer-policy')).toBe('same-origin');
	// no-store would be wrong for a stream the client reconnects to.
	expect(res.headers.get('cache-control')).toBe('no-cache');

	const reader = res.body!.getReader();
	const { value } = await reader.read();
	expect(new TextDecoder().decode(value)).toContain('event: snapshot');
	await reader.cancel();
});

// Static assets never reach the handle hook — adapter-node serves them from
// its own middleware — so they are covered by the production entrypoint
// (server.js), which the webServer command runs.
test('immutable build assets carry the headers and keep their long-term cache policy', async ({
	request
}) => {
	const html = await (await request.get('/')).text();
	const asset = html.match(/\/_app\/immutable\/[^"']+/)?.[0];
	expect(asset, 'the page must reference a build asset').toBeTruthy();
	const res = await request.get(asset!);
	expect(res.ok()).toBeTruthy();
	expectBaseHeaders(res.headers());
	expect(res.headers()['cache-control']).toContain('immutable');
	expect(res.headers()['cache-control']).not.toContain('no-store');
});

test('static files carry the headers too', async ({ request }) => {
	const res = await request.get('/robots.txt');
	expect(res.ok()).toBeTruthy();
	expectBaseHeaders(res.headers());
});

test('the theme bootstrap runs under CSP, with no violation reported', async ({ page }) => {
	const violations: string[] = [];
	page.on('console', (msg) => {
		if (/content security policy/i.test(msg.text())) violations.push(msg.text());
	});

	await page.goto('/');
	await page.evaluate(() => localStorage.setItem('swaddle.theme', 'dark'));
	await page.reload();

	// The class can only be there before hydration if the inline script ran.
	await expect(page.locator('html')).toHaveClass(/dark/);
	// The live SSE connection is part of what CSP could have blocked.
	await expect(page.getByRole('heading', { name: 'Aujourd’hui' })).toBeVisible();
	expect(violations, violations.join('\n')).toHaveLength(0);

	await page.evaluate(() => localStorage.removeItem('swaddle.theme'));
});
