import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('#46: correcting the baby profile shows pending, success and error states', async ({ page }) => {
	await page.goto('/settings');

	await page.getByRole('button', { name: /^Modifier Testine$/ }).click();
	await page.getByLabel('Prénom').fill('Testine Corrigée');
	await page.getByLabel('Date de naissance').fill('2026-07-28');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByText('Profil du bébé mis à jour.')).toBeVisible();
	await expect(page.getByText('Testine Corrigée · 2026-07-28')).toBeVisible();

	// Survives a reload.
	await page.reload();
	await expect(page.getByText('Testine Corrigée · 2026-07-28')).toBeVisible();

	// A rejected correction (server-side validation failure) shows the error
	// and keeps the previous value on screen instead of losing it.
	await page.route('**/api/babies/*', async (route) => {
		if (route.request().method() === 'PATCH') {
			await route.fulfill({
				status: 400,
				contentType: 'application/json',
				body: '{"error":{"code":"validation_failed","issues":[{"path":"name","code":"too_small","message":"too small"}]}}'
			});
			return;
		}
		await route.continue();
	});
	await page.getByRole('button', { name: /^Modifier Testine Corrigée$/ }).click();
	await page.getByLabel('Prénom').fill('Nom rejeté');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByText('Certains champs sont invalides : name')).toBeVisible();
	await page.getByRole('button', { name: 'Annuler' }).click();
	await expect(page.getByText('Testine Corrigée · 2026-07-28')).toBeVisible();
	await page.unroute('**/api/babies/*');

	// Restore the seeded baby's original name/birthdate for other specs.
	await page.getByRole('button', { name: /^Modifier Testine Corrigée$/ }).click();
	await page.getByLabel('Prénom').fill('Testine');
	await page.getByLabel('Date de naissance').fill('2026-08-01');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByText('Testine · 2026-08-01')).toBeVisible();
});

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
	await expect(page.getByRole('button', { name: 'Télécharger une sauvegarde' })).toBeVisible();
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

	// Taking a backup refreshes the timestamp without a reload.
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Télécharger une sauvegarde' }).click();
	await download;
	await expect(section).not.toContainText('jamais');
});

test('#49: restoring a different unit/theme resyncs the visible controls without a reload, and survives one', async ({
	page
}) => {
	const original = await (await page.request.get('/api/export/json')).json();
	// Flip both away from whatever this run's household currently holds, so the
	// assertions below only pass if the restore actually took effect.
	const flippedUnit = original.household.volumeUnit === 'ml' ? 'oz' : 'ml';
	const flippedTheme = original.household.theme === 'dark' ? 'light' : 'dark';
	const flipped = { ...original, household: { volumeUnit: flippedUnit, theme: flippedTheme } };

	const dir = mkdtempSync(join(tmpdir(), 'swaddle-restore-'));
	const file = join(dir, 'flipped.json');
	writeFileSync(file, JSON.stringify(flipped));

	await page.goto('/settings');
	page.once('dialog', (dialog) => dialog.accept());
	await page.setInputFiles('#restore-file', file);
	await expect(page.getByText(/^Restauré :/)).toBeVisible();

	// The controls above reflect the restored household immediately — no
	// reload — and agree with a fresh GET of the same data (issue #49).
	await expect(
		page.getByRole('button', { name: flippedUnit, exact: true })
	).toHaveClass(/bg-primary/);
	const themeLabel = flippedTheme === 'dark' ? 'Sombre' : 'Clair';
	await expect(page.getByRole('button', { name: themeLabel })).toHaveClass(/bg-primary/);
	if (flippedTheme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
	else await expect(page.locator('html')).not.toHaveClass(/dark/);
	const household = await (await page.request.get('/api/household')).json();
	expect(household).toMatchObject({ volumeUnit: flippedUnit, theme: flippedTheme });

	// Still true after a real reload (fresh load props, not just invalidateAll).
	await page.reload();
	await expect(
		page.getByRole('button', { name: flippedUnit, exact: true })
	).toHaveClass(/bg-primary/);
	await expect(page.getByRole('button', { name: themeLabel })).toHaveClass(/bg-primary/);
	if (flippedTheme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
	else await expect(page.locator('html')).not.toHaveClass(/dark/);

	// Restore the original export so later specs see the household they expect.
	const revert = await page.request.post('/api/restore', { data: original });
	expect(revert.ok()).toBeTruthy();
});
