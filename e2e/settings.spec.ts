import { expect, test } from '@playwright/test';

test('FR-011: caregivers, device, unit, theme and data controls', async ({ page }) => {
	await page.goto('/settings');

	// Aidants — add a caregiver.
	await page.getByLabel('Nom de l’aidant').fill('Mamie');
	await page.getByRole('button', { name: '#0284C7' }).click();
	await page.getByRole('button', { name: 'Ajouter un aidant' }).click();
	await expect(page.getByRole('list').getByText('Mamie')).toBeVisible();

	// Aidants — rename it inline.
	await page.getByRole('button', { name: 'Modifier Mamie' }).click();
	await page.getByLabel('Nouveau nom pour Mamie').fill('Mamie Renommée');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByRole('list').getByText('Mamie Renommée')).toBeVisible();
	await expect(page.getByRole('list').getByText('Mamie', { exact: true })).toHaveCount(0);

	// Cet appareil — select the renamed caregiver as the device user.
	await page.getByRole('radio', { name: 'Mamie Renommée' }).click();
	const stored = await page.evaluate(() => localStorage.getItem('swaddle.caregiverId'));
	expect(stored).toBeTruthy();

	// Unité — switch to oz and back, checking it persists via a fresh GET.
	await page.getByRole('button', { name: 'oz', exact: true }).click();
	await expect
		.poll(async () => (await (await page.request.get('/api/household')).json()).volumeUnit)
		.toBe('oz');
	await page.getByRole('button', { name: 'ml', exact: true }).click();
	await expect
		.poll(async () => (await (await page.request.get('/api/household')).json()).volumeUnit)
		.toBe('ml');

	// Thème — Sombre applies the .dark class, Auto removes the forced choice.
	await page.getByRole('button', { name: 'Sombre' }).click();
	await expect(page.locator('html')).toHaveClass(/dark/);
	await page.getByRole('button', { name: 'Auto' }).click();

	// Données — the four controls exist.
	await expect(page.getByRole('link', { name: 'Exporter JSON' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Exporter CSV' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Télécharger une sauvegarde' })).toBeVisible();
	await expect(page.getByLabel('Restaurer depuis un fichier')).toBeVisible();

	// Clean up the caregiver created by this spec.
	const caregivers = await (await page.request.get('/api/caregivers')).json();
	const mamie = caregivers.caregivers.find((c: { name: string }) => c.name === 'Mamie Renommée');
	if (mamie) await page.request.delete(`/api/caregivers/${mamie.id}`);
});
