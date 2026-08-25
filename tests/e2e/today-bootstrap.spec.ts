import { expect, test } from '@playwright/test';

/**
 * Issue #47: a failed Today bootstrap must read as a failure, not as a
 * genuinely empty day, and must be retryable — while startup and the initial
 * SSE snapshot still perform a single events request.
 */

const isTodayEventsRequest = (url: string) =>
	url.includes('/api/events?') && url.includes('overlap=1');

test('a failed initial events load shows a French error state instead of an empty day, and retry recovers', async ({
	page
}) => {
	const pageErrors: Error[] = [];
	page.on('pageerror', (error) => pageErrors.push(error));

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

	await page.goto('/');

	const alert = page.getByTestId('bootstrap-error');
	await expect(alert).toBeVisible();
	await expect(alert).toContainText('Une erreur est survenue.');
	// The history must not claim the day is empty while the load has failed.
	await expect(page.getByText('Aucune activité — tout commence ici')).toHaveCount(0);

	await alert.getByRole('button', { name: 'Réessayer' }).click();

	// The error clears only once authoritative data has landed.
	await expect(alert).toBeHidden();
	await expect(page.getByRole('heading', { name: 'Derniers événements' })).toBeVisible();
	await expect(page.getByText('Activités indisponibles')).toHaveCount(0);

	// An unhandled rejection from the bootstrap fetch would land here.
	expect(pageErrors).toHaveLength(0);
});

test('concurrent startup and initial SSE snapshot refreshes perform a single today-events request', async ({
	page
}) => {
	const pageErrors: Error[] = [];
	page.on('pageerror', (error) => pageErrors.push(error));

	const requests: string[] = [];
	page.on('request', (request) => {
		if (request.method() === 'GET' && isTodayEventsRequest(request.url()))
			requests.push(request.url());
	});

	// Hold the startup events request open long enough for the SSE snapshot to
	// land while it is still in flight — that is the concurrency the coalescing
	// is about, and delaying it makes the race deterministic instead of relying
	// on which of the two round trips happens to win.
	await page.route('**/api/events?**', async (route) => {
		if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 1000));
		await route.continue();
	});

	await page.goto('/');
	// Wait for the bootstrap to be settled: the section renders its final state
	// only once the events list is authoritative.
	await expect(page.getByRole('heading', { name: 'Derniers événements' })).toBeVisible();
	await expect(page.getByText('Chargement des activités…')).toHaveCount(0);
	// Give the SSE snapshot — which asks for its own refresh — time to arrive and
	// be coalesced into the startup request.
	await page.waitForTimeout(1500);

	expect(requests).toHaveLength(1);
	expect(pageErrors).toHaveLength(0);
});
