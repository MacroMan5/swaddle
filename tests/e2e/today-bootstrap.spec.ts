import { expect, test } from '@playwright/test';

/**
 * Issue #47: a failed Today bootstrap must read as a failure, not as a
 * genuinely empty day, and must be retryable. The initial SSE snapshot must
 * supersede the startup read with a causally newer authoritative request.
 */

const isTodayEventsRequest = (url: string) =>
	url.includes('/api/events?') && url.includes('overlap=1');

test('a failed initial events load shows a French error state instead of an empty day, and retry recovers', async ({
	page
}) => {
	const pageErrors: Error[] = [];
	page.on('pageerror', (error) => pageErrors.push(error));

	let failEvents = true;
	await page.route('**/api/events?**', async (route) => {
		if (route.request().method() === 'GET' && failEvents) {
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

	failEvents = false;
	await alert.getByRole('button', { name: 'Réessayer' }).click();

	// The error clears only once authoritative data has landed.
	await expect(alert).toBeHidden();
	await expect(page.getByRole('heading', { name: 'Derniers événements' })).toBeVisible();
	await expect(page.getByText('Activités indisponibles')).toHaveCount(0);

	// An unhandled rejection from the bootstrap fetch would land here.
	expect(pageErrors).toHaveLength(0);
});

test('one Réessayer click recovers when both the context load and the events load have failed', async ({
	page
}) => {
	const pageErrors: Error[] = [];
	page.on('pageerror', (error) => pageErrors.push(error));

	const unavailable = {
		status: 503,
		contentType: 'application/json',
		body: JSON.stringify({ error: { code: 'internal', message: 'unavailable' } })
	};
	let failEvents = true;
	let failCaregivers = false;
	await page.route('**/api/events?**', async (route) => {
		if (route.request().method() === 'GET' && failEvents) return route.fulfill(unavailable);
		await route.continue();
	});
	await page.route('**/api/caregivers', async (route) => {
		if (route.request().method() === 'GET' && failCaregivers) return route.fulfill(unavailable);
		await route.continue();
	});

	// (1) The events load fails; the baby/caregiver load succeeds, so the store
	// is running for baby-1 and holds the events error.
	await page.goto('/');
	const alert = page.getByTestId('bootstrap-error');
	await expect(alert).toBeVisible();
	await expect(page.getByText('Activités indisponibles')).toBeVisible();

	// (2) Leave Today and come back: the store is layout-scoped, so it keeps the
	// events error across the client-side navigation, and this time the fresh
	// loadBaby() fails too — both errors are now set at once.
	failCaregivers = true;
	await page.getByRole('link', { name: 'Historique' }).click();
	await expect(page).toHaveURL(/\/history$/);
	await page.getByRole('link', { name: 'Aujourd’hui' }).click();
	await expect(alert).toBeVisible();

	// (3) Everything recovers server-side: a single click must retry both. The
	// baby load alone would clear the alert's first message and leave the events
	// error behind, still showing the alert.
	failEvents = false;
	failCaregivers = false;
	await alert.getByRole('button', { name: 'Réessayer' }).click();

	await expect(alert).toBeHidden();
	await expect(page.getByText('Activités indisponibles')).toHaveCount(0);
	await expect(page.getByText('Chargement des activités…')).toHaveCount(0);

	expect(pageErrors).toHaveLength(0);
});

test('the initial SSE snapshot supersedes the startup read with one fresh today-events request', async ({
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
	// land while it is still in flight. Recovery must detach that stale read and
	// request a post-snapshot baseline instead of coalescing with it.
	await page.route('**/api/events?**', async (route) => {
		if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 1000));
		await route.continue();
	});

	await page.goto('/');
	// Wait for the bootstrap to be settled: the section renders its final state
	// only once the events list is authoritative.
	await expect(page.getByRole('heading', { name: 'Derniers événements' })).toBeVisible();
	await expect(page.getByText('Chargement des activités…')).toHaveCount(0);
	// Give the snapshot's replacement read time to settle. Exactly two requests
	// means one startup baseline and one recovery baseline, without a loop.
	await page.waitForTimeout(1500);

	expect(requests).toHaveLength(2);
	expect(pageErrors).toHaveLength(0);
});
