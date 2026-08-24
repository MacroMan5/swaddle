import { expect, test } from '@playwright/test';

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
