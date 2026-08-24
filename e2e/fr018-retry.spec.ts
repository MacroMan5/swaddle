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
				body: JSON.stringify({ error: { code: 'internal', message: 'temporarily unavailable' } })
			});
			return;
		}
		await route.continue();
	});

	await page.getByRole('button', { name: 'Enregistrer' }).click();

	// (a) failure surfaces a French error, (c) nothing renders as saved yet.
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page.getByRole('status')).toHaveCount(0);
	// The sheet stays open and the volume the user typed is still there.
	await expect(page.getByLabel(/volume/i)).toHaveValue('90');

	// (b) resubmitting with the kept value is the retry.
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByRole('status')).toContainText('Biberon');

	const { events } = await (await request.get('/api/events?babyId=baby-1')).json();
	const bottle = events.find((e: { type: string }) => e.type === 'bottle');
	expect(bottle.details).toMatchObject({ milkType: 'formula', volumeMl: 90 });

	// Leaves the shared seeded server clean for other specs (e.g. history.spec.ts
	// sums today's bottle volumes and would otherwise pick up this 90 ml).
	await request.delete(`/api/events/${bottle.id}`);
});

test('FR-018: a failed caregiver add keeps the input and lets the user retry', async ({
	page,
	request
}) => {
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
	await page.getByRole('button', { name: 'Ajouter un aidant' }).click();
	await expect(page.getByRole('list').getByText(name)).toBeVisible();

	const { caregivers } = await (await request.get('/api/caregivers')).json();
	const created = caregivers.find((c: { name: string }) => c.name === name);
	expect(created).toBeTruthy();

	// Leaves the shared seeded server clean for other specs.
	await request.delete(`/api/caregivers/${created.id}`);
});
