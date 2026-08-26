import { expect, test } from '@playwright/test';

test('manual-add sheet does not reset while open (review P1): a field keeps its value across the clock tick', async ({
	page
}) => {
	await page.goto('/history');
	await page.getByRole('button', { name: 'Ajouter' }).click();
	await page.getByRole('button', { name: 'Biberon', exact: true }).click();

	const volumeField = page.getByLabel('Volume (ml)');
	await volumeField.fill('120');

	// SyncStore's nowMs ticks every second; the sheet's init effect must not
	// depend on it, or the field (and the whole form) resets mid-entry.
	await page.waitForTimeout(1500);

	await expect(volumeField).toHaveValue('120');
	// Still on the bottle form, not reset back to the type chooser.
	await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeVisible();
});

test('the edit sheet does not reset while open either: a field keeps its value across the clock tick', async ({
	page,
	request
}) => {
	// Same review-P1 rule as the manual-add sheet above, on the *edit* sheet:
	// the page re-derives its event list every second from the corrected clock,
	// so the DTO handed to the sheet is a fresh object each tick. The sheet's
	// init effect must key on the event's identity, not on that object, or it
	// re-initializes mid-entry and silently discards what the user typed.
	await request.post('/api/events', {
		data: {
			babyId: 'baby-1',
			type: 'bottle',
			startedAt: new Date().toISOString(),
			details: { milkType: 'formula', volumeMl: 173 }
		}
	});

	await page.goto('/history');
	await page.getByTestId('event-row').filter({ hasText: '173' }).click();
	const volumeField = page.getByLabel('Volume (ml)');
	await volumeField.fill('174');
	await page.waitForTimeout(1500);
	await expect(volumeField).toHaveValue('174');

	// And the typed value is what actually gets saved.
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByTestId('event-row').filter({ hasText: '174' })).toHaveCount(1);
});

test('manual-add a bottle yesterday, edit its volume, delete it with undo, then let a second delete stick', async ({
	page
}) => {
	await page.goto('/history');
	await page.getByRole('button', { name: 'Jour précédent' }).click();

	// Manual add (FR-006).
	await page.getByRole('button', { name: 'Ajouter' }).click();
	await page.getByRole('button', { name: 'Biberon', exact: true }).click();
	await page.getByLabel('Volume (ml)').fill('120');
	await page.getByRole('button', { name: 'Enregistrer' }).click();

	const row = page.getByTestId('event-row').filter({ hasText: 'Biberon' });
	await expect(row).toContainText('120');

	// Edit (FR-007).
	await row.click();
	const volumeField = page.getByLabel('Volume (ml)');
	await volumeField.fill('150');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(row).toContainText('150');

	// Delete with undo.
	await row.click();
	await page.getByRole('button', { name: 'Supprimer' }).click();
	const toast = page.getByRole('status');
	await expect(toast).toContainText('Entrée supprimée');
	await expect(page.getByTestId('event-row').filter({ hasText: 'Biberon' })).toHaveCount(0);

	await toast.getByRole('button', { name: 'Annuler' }).click();
	await expect(toast).toBeHidden();
	await expect(page.getByTestId('event-row').filter({ hasText: 'Biberon' })).toHaveCount(1);

	// Delete again and let the toast expire — the row stays gone after a reload.
	await page.getByTestId('event-row').filter({ hasText: 'Biberon' }).click();
	await page.getByRole('button', { name: 'Supprimer' }).click();
	await expect(page.getByRole('status')).toBeVisible();
	await expect(page.getByRole('status')).toBeHidden({ timeout: 7000 });
	await page.reload();
	await page.getByRole('button', { name: 'Jour précédent' }).click();
	await expect(page.getByTestId('event-row').filter({ hasText: 'Biberon' })).toHaveCount(0);
});

test('manual-add a pump without a volume sends null, not a phantom 0 (issue #36)', async ({
	page
}) => {
	// ManualAddSheet always fills in a Fin (end) time, so a manually-added pump
	// is always a *completed* session server-side, and a completed pump still
	// requires a volume (src/lib/server/events/types.ts). The fix isn't that
	// this now succeeds — it's that the empty field is sent as `null` (like
	// EventEditSheet) instead of `Number('') === 0`, so the rejection surfaces
	// the correct business message instead of the generic "at least 1 ml" one.
	await page.goto('/history');
	await page.getByRole('button', { name: 'Ajouter' }).click();
	await page.getByRole('button', { name: 'Tirage', exact: true }).click();

	await page.getByRole('button', { name: 'Enregistrer' }).click();

	await expect(page.getByRole('alert')).toContainText(
		'Le volume est requis pour terminer le tirage.'
	);
	await expect(page.getByTestId('event-row').filter({ hasText: 'Tirage' })).toHaveCount(0);
});
