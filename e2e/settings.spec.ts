import { expect, test } from '@playwright/test';

test('FR-011: caregivers, device, unit, theme and data controls', async ({ page }) => {
	await page.goto('/settings');

	// Aidants — add a caregiver.
	await page.getByLabel('Nom de l’aidant').fill('Mamie');
	await page.getByRole('button', { name: 'Bleu' }).click();
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

	// Thème — a failed save rolls back the optimistic class/localStorage change
	// instead of presenting an unsaved theme as persistent.
	await page.route('**/api/household', async (route) => {
		if (route.request().method() === 'PATCH') {
			await route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: '{"error":{"code":"internal_error","message":"boom"}}'
			});
			return;
		}
		await route.continue();
	});
	await page.getByRole('button', { name: 'Sombre' }).click();
	await expect(page.getByText('Une erreur est survenue.')).toBeVisible();
	await expect(page.locator('html')).not.toHaveClass(/dark/);
	const storedTheme = await page.evaluate(() => localStorage.getItem('swaddle.theme'));
	expect(storedTheme).toBe('auto');
	await page.unroute('**/api/household');
	const household = await (await page.request.get('/api/household')).json();
	expect(household.theme).toBe('auto');

	// Données — the four controls exist.
	await expect(page.getByRole('link', { name: 'Exporter JSON' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Exporter CSV' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Télécharger une sauvegarde' })).toBeVisible();
	// The native file input is visually hidden (browser-chrome English widget);
	// the styled button is the visible control and forwards clicks to it.
	await expect(page.getByRole('button', { name: 'Restaurer depuis un fichier…' })).toBeVisible();
	// aria-hidden + tabindex=-1: the input is out of the tab order and the
	// accessibility tree, so target it by id rather than by accessible name.
	await expect(page.locator('#restore-file')).toBeAttached();

	// Clean up the caregiver created by this spec.
	const caregivers = await (await page.request.get('/api/caregivers')).json();
	const mamie = caregivers.caregivers.find((c: { name: string }) => c.name === 'Mamie Renommée');
	if (mamie) await page.request.delete(`/api/caregivers/${mamie.id}`);
});

test('the Ce serveur block shows the address and connected device count', async ({ page }) => {
	await page.goto('/settings');
	const section = page.getByRole('heading', { name: 'Ce serveur' }).locator('..');
	await expect(section.getByText('Adresse')).toBeVisible();
	// The address is the origin the page itself was served from.
	await expect(section).toContainText(new URL(page.url()).host);
	await expect(section.getByText('Appareils connectés')).toBeVisible();
	await expect(section.getByText('Dernière sauvegarde')).toBeVisible();
});
