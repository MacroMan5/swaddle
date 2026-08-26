import { expect, test } from '@playwright/test';

// Issue #48: a device's stored caregiver selection must never survive that
// caregiver's deletion — locally or on another device — and must never be
// sent in a new event/timer write once it is gone.

test.afterEach(async ({ request }) => {
	for (const type of ['nursing', 'pump', 'sleep'])
		await request.post(`/api/timers/${type}/stop`, {
			data: { babyId: 'baby-1', ...(type === 'pump' ? { volumeMl: 10 } : {}) }
		});
});

test('a caregiver deleted on another device is reconciled on the next bootstrap, and every activity type still records', async ({
	page,
	request
}) => {
	// The caregiver reconciliation should fall back to: whichever one already
	// exists (its id isn't assumed to be the seeded 'cg-1' literal — another
	// spec in the suite may have gone through an export/restore roundtrip that
	// reassigns ids).
	const before = await (await request.get('/api/caregivers')).json();
	const fallbackId = before.caregivers[0].id;

	// This device previously selected a caregiver that another device is about
	// to remove.
	const created = await (
		await request.post('/api/caregivers', { data: { name: 'Visite', color: '#059669' } })
	).json();
	await page.addInitScript((id) => localStorage.setItem('swaddle.caregiverId', id), created.id);

	await page.goto('/');
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('swaddle.caregiverId')))
		.toBe(created.id);

	// Another device deletes it — this device is not told directly.
	await request.delete(`/api/caregivers/${created.id}`);

	// Next bootstrap: no generic validation failure, and the stale id is
	// replaced by the remaining caregiver on its own.
	await page.reload();
	await expect(page.getByTestId('bootstrap-error')).toBeHidden();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('swaddle.caregiverId')))
		.toBe(fallbackId);

	// Diaper (one-touch).
	await page.getByRole('button', { name: 'Pipi', exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Couche enregistrée');
	const afterDiaper = await (await request.get('/api/events?babyId=baby-1')).json();
	const diaper = afterDiaper.events.find(
		(e: { type: string; details: { pee: boolean } }) => e.type === 'diaper' && e.details.pee
	);
	expect(diaper.caregiverId).toBe(fallbackId);

	// Bottle.
	await page.getByRole('button', { name: 'Biberon' }).click();
	await page.getByRole('button', { name: 'Préparation' }).click();
	await page.getByLabel(/volume/i).fill('90');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	// The diaper toast from the previous step may still be up (5 s undo window).
	await expect(page.getByRole('status').last()).toContainText('Biberon');
	const afterBottle = await (await request.get('/api/events?babyId=baby-1')).json();
	const bottle = afterBottle.events.find(
		(e: { type: string; details: { volumeMl: number } }) =>
			e.type === 'bottle' && e.details.volumeMl === 90
	);
	expect(bottle.caregiverId).toBe(fallbackId);

	// Nursing.
	await page.getByRole('button', { name: 'Allaiter' }).click();
	await page.getByTestId('nursing-side-left').click();
	await expect(page.getByTestId('nursing-sheet')).toContainText('Gauche en cours');
	await page
		.getByTestId('nursing-sheet')
		.getByRole('button', { name: 'Terminer la tétée' })
		.click();
	await expect(page.getByTestId('active-timers')).toBeHidden();
	const afterNursing = await (await request.get('/api/events?babyId=baby-1')).json();
	const nursing = afterNursing.events.find((e: { type: string }) => e.type === 'nursing');
	expect(nursing.caregiverId).toBe(fallbackId);

	// Pump.
	await page.getByRole('button', { name: 'Tirage' }).click();
	await page.getByLabel('Tirage').getByRole('button', { name: 'Les deux' }).click();
	const activeTimers = page.getByTestId('active-timers');
	await activeTimers.getByLabel(/volume/i).fill('80');
	await activeTimers.getByRole('button', { name: 'Terminer' }).click();
	await expect(activeTimers).toBeHidden();
	const afterPump = await (await request.get('/api/events?babyId=baby-1')).json();
	const pump = afterPump.events.find(
		(e: { type: string; details: { volumeMl: number } }) =>
			e.type === 'pump' && e.details.volumeMl === 80
	);
	expect(pump.caregiverId).toBe(fallbackId);

	// Sleep. Captured by id (not by "most recent sleep event") because
	// api-timers.spec.ts leaves a future-dated sleep session in the fixture
	// data, which would otherwise sort ahead of this one.
	await page.getByRole('button', { name: 'Commencer le sommeil' }).click();
	await expect(page.getByTestId('active-timers')).toContainText('Sommeil');
	const { timers } = await (await request.get('/api/timers?babyId=baby-1')).json();
	const sleepId = timers.find((t: { type: string }) => t.type === 'sleep').id;
	await page.getByRole('button', { name: 'Réveillé' }).click();
	await expect(page.getByTestId('active-timers')).toBeHidden();
	const afterSleep = await (await request.get('/api/events?babyId=baby-1')).json();
	const sleep = afterSleep.events.find((e: { id: string }) => e.id === sleepId);
	expect(sleep.caregiverId).toBe(fallbackId);
});

test('deleting the current device caregiver in Settings reconciles the device selection immediately', async ({
	page,
	request
}) => {
	// The reconciled fallback isn't assumed to be a specific name/id — whatever
	// caregiver already exists before this test adds its own.
	const before = await (await request.get('/api/caregivers')).json();
	const fallbackId = before.caregivers[0].id;

	await page.goto('/settings');
	await page.getByLabel('Nom de l’aidant').fill('Tante');
	await page.getByRole('button', { name: 'Vert' }).click();
	await page.getByRole('button', { name: 'Ajouter un aidant' }).click();
	await expect(page.getByRole('list').getByText('Tante')).toBeVisible();

	await page.getByRole('radio', { name: 'Tante' }).click();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('swaddle.caregiverId')))
		.not.toBeNull();

	// Unused (never sent in a write), so the delete itself succeeds.
	await page.getByRole('button', { name: 'Supprimer Tante' }).click();
	await expect(page.getByRole('list').getByText('Tante')).toHaveCount(0);

	// Reconciled without a reload: the device falls back to the remaining
	// caregiver, and its radio reflects it.
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('swaddle.caregiverId')))
		.toBe(fallbackId);
	await expect(page.locator(`#device-${fallbackId}`)).toBeChecked();
});
