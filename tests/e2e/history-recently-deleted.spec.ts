import { expect, test } from '@playwright/test';

// Issue #50: the five-second undo toast (history-edit.spec.ts) is a
// convenience, not the only way back — "Supprimés récemment" must recover a
// deleted event after the toast has expired, after navigation/reload, and
// must surface a timer conflict (FR-013) through the French userMessage.
//
// Other specs sharing this suite's single worker/data dir also delete events
// for baby-1, so rows are matched by "most recently deleted" (list order,
// deletedAt DESC) rather than by a type/volume text that could collide with
// leftovers from another spec.

test('recovers a deleted event after the undo toast has expired', async ({ page }) => {
	await page.goto('/history');

	await page.getByRole('button', { name: 'Ajouter' }).click();
	await page.getByRole('button', { name: 'Biberon', exact: true }).click();
	await page.getByLabel('Volume (ml)').fill('130');
	await page.getByRole('button', { name: 'Enregistrer' }).click();

	const row = page.getByTestId('event-row').filter({ hasText: '130' });
	await expect(row).toHaveCount(1);

	await row.click();
	await page.getByRole('button', { name: 'Supprimer' }).click();
	await expect(page.getByTestId('event-row').filter({ hasText: '130' })).toHaveCount(0);

	// Let the 5 s undo toast expire.
	await expect(page.getByRole('status')).toBeHidden({ timeout: 7000 });

	await page.getByRole('button', { name: 'Supprimés récemment' }).click();
	const deletedRow = page.getByTestId('recently-deleted-row').first();
	await expect(deletedRow).toContainText('Biberon');
	await expect(deletedRow).toContainText('130');
	await deletedRow.getByRole('button', { name: /Restaurer/ }).click();

	await expect(page.getByTestId('recently-deleted-row').filter({ hasText: '130' })).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('event-row').filter({ hasText: '130' })).toHaveCount(1);
});

test('a restored event survives navigation and reload', async ({ page }) => {
	await page.goto('/history');

	await page.getByRole('button', { name: 'Ajouter' }).click();
	await page.getByRole('button', { name: 'Biberon', exact: true }).click();
	await page.getByLabel('Volume (ml)').fill('141');
	await page.getByRole('button', { name: 'Enregistrer' }).click();

	const row = page.getByTestId('event-row').filter({ hasText: '141' });
	await row.click();
	await page.getByRole('button', { name: 'Supprimer' }).click();
	await expect(page.getByRole('status')).toBeVisible();

	// Navigate away before the toast resolves, then come back and reload —
	// the deleted event must still be reachable through "Supprimés récemment".
	await page.getByRole('link', { name: /Aujourd.hui/ }).click();
	await page.goto('/history');
	await page.reload();

	await page.getByRole('button', { name: 'Supprimés récemment' }).click();
	const deletedRow = page.getByTestId('recently-deleted-row').first();
	await expect(deletedRow).toContainText('141');
	await deletedRow.getByRole('button', { name: /Restaurer/ }).click();
	await expect(page.getByTestId('recently-deleted-row').filter({ hasText: '141' })).toHaveCount(0);

	await page.keyboard.press('Escape');
	await page.reload();
	await expect(page.getByTestId('event-row').filter({ hasText: '141' })).toHaveCount(1);
});

test('restoring a timer event surfaces the active-timer conflict (FR-013)', async ({
	page,
	request
}) => {
	const start = await request.post('/api/timers/sleep/start', { data: { babyId: 'baby-1' } });
	expect(start.status()).toBe(201);
	const { event: firstTimer } = await start.json();

	const del = await request.delete(`/api/events/${firstTimer.id}`);
	expect(del.status()).toBe(200);

	// A second sleep timer is now the only active one; restoring the deleted
	// one must conflict with it instead of duplicating an active timer.
	const restart = await request.post('/api/timers/sleep/start', { data: { babyId: 'baby-1' } });
	expect(restart.status()).toBe(201);

	await page.goto('/history');
	await page.getByRole('button', { name: 'Supprimés récemment' }).click();
	const deletedRow = page.getByTestId('recently-deleted-row').first();
	await expect(deletedRow).toContainText('Sommeil');
	await deletedRow.getByRole('button', { name: /Restaurer/ }).click();

	await expect(page.getByRole('alert')).toContainText('Une séance est déjà en cours.');
	// The conflicting row stays listed — the restore did not silently succeed.
	await expect(page.getByTestId('recently-deleted-row').first()).toContainText('Sommeil');

	// Leave no active timer behind for later specs sharing this baby.
	await request.post('/api/timers/sleep/stop', { data: { babyId: 'baby-1' } });
});
