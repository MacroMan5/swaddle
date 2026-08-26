import { expect, test } from '@playwright/test';

test.afterEach(async ({ request }) => {
	for (const type of ['nursing', 'pump', 'sleep'])
		await request.post(`/api/timers/${type}/stop`, {
			data: { babyId: 'baby-1', ...(type === 'pump' ? { volumeMl: 10 } : {}) }
		});
});

test('FR-018: a failed bottle write keeps the input, lets the user retry, and only shows saved on success', async ({
	page,
	request
}) => {
	let bottleId: string | undefined;
	try {
		await page.goto('/');
		await page.getByRole('button', { name: 'Biberon' }).click();
		await page.getByRole('button', { name: 'Préparation' }).click();
		await page.getByLabel(/volume/i).fill('90');

		let failed = false;
		await page.route('**/api/events', async (route) => {
			if (route.request().method() === 'POST' && !failed) {
				failed = true;
				await route.fulfill({
					status: 503,
					contentType: 'application/json',
					body: JSON.stringify({
						error: { code: 'internal', message: 'Service temporairement indisponible.' }
					})
				});
				return;
			}
			await route.continue();
		});

		await page.getByRole('button', { name: 'Enregistrer' }).click();

		// (a) failure surfaces ApiError.userMessage, the French text derived from
		// the mocked code ('internal' is unmapped, so it falls back to the generic
		// message) — never the raw server text, English or otherwise —,
		// (c) nothing renders as saved yet.
		await expect(page.getByRole('alert')).toHaveText('Une erreur est survenue.');
		await expect(page.getByRole('status')).toHaveCount(0);
		// The sheet stays open and the volume the user typed is still there.
		await expect(page.getByLabel(/volume/i)).toHaveValue('90');

		// (b) resubmitting with the kept value is the retry.
		const [response] = await Promise.all([
			page.waitForResponse(
				(res) => res.url().includes('/api/events') && res.request().method() === 'POST'
			),
			page.getByRole('button', { name: 'Enregistrer' }).click()
		]);
		// A generous timeout: the save toast's render lands slightly after the API
		// response settles, and that margin is tighter under WebKit than Chromium.
		await expect(page.getByRole('status')).toContainText('Biberon', { timeout: 10_000 });

		bottleId = (await response.json()).id;
		expect(bottleId).toBeTruthy();
		const created = await (await request.get(`/api/events/${bottleId}`)).json();
		expect(created.details).toMatchObject({ milkType: 'formula', volumeMl: 90 });
	} finally {
		// Leaves the shared seeded server clean for other specs (e.g. history.spec.ts
		// sums today's bottle volumes and would otherwise pick up this 90 ml).
		if (bottleId) await request.delete(`/api/events/${bottleId}`);
	}
});

test('FR-018: a transport failure on the bottle write shows the generic French fallback, not a raw error', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Biberon' }).click();
	await page.getByRole('button', { name: 'Préparation' }).click();
	await page.getByLabel(/volume/i).fill('90');

	// A dropped connection, not an HTTP error response: `fetch()` itself
	// rejects, so there is no ApiError/envelope to read a message from.
	await page.route('**/api/events', (route) => route.abort('connectionreset'));

	await page.getByRole('button', { name: 'Enregistrer' }).click();

	await expect(page.getByRole('alert')).toHaveText('Une erreur est survenue.');
	await expect(page.getByRole('status')).toHaveCount(0);
	await expect(page.getByLabel(/volume/i)).toHaveValue('90');
});

test('FR-018: a failed caregiver add keeps the input and lets the user retry', async ({
	page,
	request
}) => {
	let caregiverId: string | undefined;
	try {
		await page.goto('/settings');

		const name = `Retry ${Date.now()}`;
		await page.getByLabel('Nom de l’aidant').fill(name);

		let failed = false;
		await page.route('**/api/caregivers', async (route) => {
			if (route.request().method() === 'POST' && !failed) {
				failed = true;
				await route.fulfill({
					status: 503,
					contentType: 'application/json',
					body: JSON.stringify({ error: { code: 'internal', message: 'temporarily unavailable' } })
				});
				return;
			}
			await route.continue();
		});

		await page.getByRole('button', { name: 'Ajouter un aidant' }).click();

		// (a) failure surfaces an error, (c) nothing renders as saved yet.
		await expect(page.getByText('Une erreur est survenue.')).toBeVisible();
		await expect(page.getByRole('list').getByText(name)).toHaveCount(0);
		// The name the user typed is still there.
		await expect(page.getByLabel('Nom de l’aidant')).toHaveValue(name);

		// (b) resubmitting with the kept value is the retry.
		const [response] = await Promise.all([
			page.waitForResponse(
				(res) => res.url().includes('/api/caregivers') && res.request().method() === 'POST'
			),
			page.getByRole('button', { name: 'Ajouter un aidant' }).click()
		]);
		await expect(page.getByRole('list').getByText(name)).toBeVisible();

		caregiverId = (await response.json()).id;
		expect(caregiverId).toBeTruthy();
	} finally {
		// Leaves the shared seeded server clean for other specs.
		if (caregiverId) await request.delete(`/api/caregivers/${caregiverId}`);
	}
});

test('FR-018: a transport failure on the volume-unit save rolls back and shows the French fallback', async ({
	page,
	request
}) => {
	// Deterministic starting point regardless of what other specs left behind
	// (this file's own request context, not mocked by the page.route below).
	await request.patch('/api/household', { data: { volumeUnit: 'ml' } });
	await page.goto('/settings');

	const mlButton = page.getByRole('button', { name: 'ml', exact: true });
	const ozButton = page.getByRole('button', { name: 'oz', exact: true });
	// "default" variant (selected) renders bg-primary; "outline" renders bg-surface-raised.
	await expect(mlButton).toHaveClass(/bg-primary/);
	await expect(ozButton).toHaveClass(/bg-surface-raised/);

	await page.route('**/api/household', (route) => route.abort('connectionreset'));

	await ozButton.click();
	// (c) the optimistic switch to oz rolls back once the transport failure is
	// known, (a)/(b) a French error appears and the buttons are clickable again.
	await expect(page.getByText('Une erreur est survenue.')).toBeVisible();
	await expect(mlButton).toHaveClass(/bg-primary/);
	await expect(ozButton).toHaveClass(/bg-surface-raised/);
	await expect(ozButton).toBeEnabled();
});
