import { expect, test } from '@playwright/test';

test('AC-001: one-touch diaper is recorded and undoable for 5 s', async ({ page, request }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Pipi', exact: true }).click();

	const toast = page.getByRole('status');
	await expect(toast).toContainText('Couche enregistrée');
	await expect(toast.getByRole('button', { name: 'Annuler' })).toBeVisible();

	// The event exists server-side…
	const before = await (await request.get('/api/events?babyId=baby-1')).json();
	const diaper = before.events.find(
		(e: { type: string; details: { pee: boolean } }) => e.type === 'diaper' && e.details.pee
	);
	expect(diaper).toBeTruthy();

	// …and Annuler soft-deletes it.
	await toast.getByRole('button', { name: 'Annuler' }).click();
	await expect(toast).toBeHidden();
	const after = await (await request.get('/api/events?babyId=baby-1')).json();
	expect(after.events.map((e: { id: string }) => e.id)).not.toContain(diaper.id);
});

test('the toast disappears by itself after 5 s', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Caca', exact: true }).click();
	await expect(page.getByRole('status')).toBeVisible();
	await expect(page.getByRole('status')).toBeHidden({ timeout: 7000 });
});
