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
	await expect(
		page.getByRole('status').filter({ hasText: 'Profil du bébé mis à jour.' })
	).toBeVisible();
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
	const babyAlert = page.getByRole('alert').filter({ hasText: 'Certains champs sont invalides : name' });
	await expect(babyAlert).toBeVisible();
	await expect(page.getByLabel('Prénom')).toHaveAttribute('aria-invalid', 'true');
	const babyAlertId = await babyAlert.getAttribute('id');
	expect(babyAlertId).toBeTruthy();
	await expect(page.getByLabel('Prénom')).toHaveAttribute('aria-describedby', babyAlertId!);
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

	// Aidants — add a caregiver; the success is announced via a polite status
	// message even though the list update is the only visible confirmation
	// (issue #52).
	await page.getByLabel('Nom de l’aidant').fill('Mamie');
	await page.getByRole('button', { name: 'Bleu' }).click();
	await page.getByRole('button', { name: 'Ajouter un aidant' }).click();
	await expect(page.getByRole('list').getByText('Mamie')).toBeVisible();
	await expect(page.getByRole('status').filter({ hasText: 'Aidant Mamie ajouté.' })).toBeAttached();

	// Aidants — rename it inline; also announced.
	await page.getByRole('button', { name: 'Modifier Mamie' }).click();
	await page.getByLabel('Nouveau nom pour Mamie').fill('Mamie Renommée');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByRole('list').getByText('Mamie Renommée')).toBeVisible();
	await expect(page.getByRole('list').getByText('Mamie', { exact: true })).toHaveCount(0);
	await expect(
		page.getByRole('status').filter({ hasText: 'Aidant Mamie Renommée mis à jour.' })
	).toBeAttached();

	// Cet appareil — select the renamed caregiver as the device user.
	await page.getByRole('radio', { name: 'Mamie Renommée' }).click();
	const stored = await page.evaluate(() => localStorage.getItem('swaddle.caregiverId'));
	expect(stored).toBeTruthy();

	// Unité — switch to oz and back, checking it persists via a fresh GET; each
	// change announces a status (sr-only — the pressed button styling is the
	// visible feedback, issue #52).
	await page.getByRole('button', { name: 'oz', exact: true }).click();
	await expect
		.poll(async () => (await (await page.request.get('/api/household')).json()).volumeUnit)
		.toBe('oz');
	await expect(page.getByRole('status').filter({ hasText: 'Unité mise à jour : oz.' })).toBeAttached();
	await page.getByRole('button', { name: 'ml', exact: true }).click();
	await expect
		.poll(async () => (await (await page.request.get('/api/household')).json()).volumeUnit)
		.toBe('ml');
	await expect(page.getByRole('status').filter({ hasText: 'Unité mise à jour : ml.' })).toBeAttached();

	// Thème — Sombre applies the .dark class, Auto removes the forced choice;
	// the change is also announced (sr-only, issue #52).
	await page.getByRole('button', { name: 'Sombre' }).click();
	await expect(page.locator('html')).toHaveClass(/dark/);
	await expect(
		page.getByRole('status').filter({ hasText: 'Thème mis à jour : Sombre.' })
	).toBeAttached();
	await page.getByRole('button', { name: 'Auto' }).click();

	// Thème — a failed save rolls back the optimistic class/localStorage change
	// instead of presenting an unsaved theme as persistent, and the failure is
	// announced as an alert exactly once, described by the triggering buttons.
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
	const themeAlert = page.getByRole('alert').filter({ hasText: 'Une erreur est survenue.' });
	await expect(themeAlert).toBeVisible();
	await expect(themeAlert).toHaveCount(1);
	await expect(page.locator('html')).not.toHaveClass(/dark/);
	const storedTheme = await page.evaluate(() => localStorage.getItem('swaddle.theme'));
	expect(storedTheme).toBe('auto');
	const themeAlertId = await themeAlert.getAttribute('id');
	expect(themeAlertId).toBeTruthy();
	await expect(page.getByRole('button', { name: 'Sombre' })).toHaveAttribute(
		'aria-describedby',
		themeAlertId!
	);
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

	// Taking a backup refreshes the timestamp without a reload, and announces a
	// (sr-only) success status — the download itself is the visible feedback
	// (issue #52).
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Télécharger une sauvegarde' }).click();
	await download;
	await expect(section).not.toContainText('jamais');
	await expect(page.getByRole('status').filter({ hasText: 'Sauvegarde téléchargée.' })).toBeAttached();
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

test('#45: a file above the 10 Mo bound is refused without being read or sent', async ({ page }) => {
	await page.goto('/settings');
	const before = await (await page.request.get('/api/export/json')).json();

	const posted: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().includes('/api/restore')) posted.push(r.url());
	});

	await page.locator('#restore-file').setInputFiles({
		name: 'swaddle-export.json',
		mimeType: 'application/json',
		buffer: Buffer.from(`{"pad":"${'x'.repeat(11 * 1024 * 1024)}"}`)
	});

	const restoreAlert = page.getByRole('alert').filter({ hasText: 'Fichier trop volumineux (10 Mo maximum).' });
	await expect(restoreAlert).toBeVisible();
	const restoreAlertId = await restoreAlert.getAttribute('id');
	expect(restoreAlertId).toBeTruthy();
	await expect(page.getByRole('button', { name: 'Restaurer depuis un fichier…' })).toHaveAttribute(
		'aria-describedby',
		restoreAlertId!
	);
	expect(posted).toHaveLength(0);
	const after = await (await page.request.get('/api/export/json')).json();
	expect(after.events).toEqual(before.events);
});

test('#52: the live region is mounted before any outcome and repeated identical outcomes re-announce in place, without moving focus', async ({
	page
}) => {
	await page.goto('/settings');

	// The alert region exists (empty) as soon as the page loads, before any
	// outcome occurs — a screen reader that has already registered it will
	// hear a later mutation, unlike a region only inserted after the fact.
	const pinErrorRegion = page.locator('#pin-error');
	await expect(pinErrorRegion).toBeAttached();
	await expect(pinErrorRegion).toHaveText('');

	// Force the same PIN mismatch error twice in a row: identical text, but a
	// screen reader must be told about it both times. LiveMessage blanks and
	// resets the region's content on every nonce bump — mutating the
	// already-registered element in place — rather than unmounting it, which
	// is what forces the re-announcement (see LiveMessage.svelte).
	await page.getByLabel('Nouveau code (4 à 8 chiffres)').fill('1234');
	await page.getByLabel('Confirmer le code').fill('4321');
	const enableButton = page.getByRole('button', { name: 'Activer le code PIN' });
	await enableButton.focus();
	await enableButton.click();

	await expect(pinErrorRegion).toHaveText('Les deux codes ne correspondent pas.');
	await expect(page.getByLabel('Nouveau code (4 à 8 chiffres)')).toHaveAttribute('aria-invalid', 'true');
	await expect(page.getByLabel('Nouveau code (4 à 8 chiffres)')).toHaveAttribute(
		'aria-describedby',
		'pin-error'
	);
	// Mark the node so the next assertion can confirm it is the very same
	// element after a second identical outcome, not a freshly inserted one.
	await pinErrorRegion.evaluate((el) => el.setAttribute('data-marker', '1'));
	// The outcome must not move focus. WebKit does not focus a clicked button
	// (macOS behavior — mousedown even blurs an explicitly focused one), so
	// asserting focus on the button itself is engine-specific; what the AC
	// requires is that the *outcome* causes no focus jump: the active element
	// is never the live region and stays put across a repeated outcome.
	const activeAfterFirst = await page.evaluate(
		() => document.activeElement?.id || document.activeElement?.tagName || ''
	);
	expect(activeAfterFirst).not.toBe('pin-error');

	await enableButton.click();
	await expect(page.locator('#pin-error[data-marker="1"]')).toHaveText(
		'Les deux codes ne correspondent pas.'
	);
	const activeAfterSecond = await page.evaluate(
		() => document.activeElement?.id || document.activeElement?.tagName || ''
	);
	expect(activeAfterSecond).toBe(activeAfterFirst);
	expect(activeAfterSecond).not.toBe('pin-error');
});

test('#52: caregiver create/edit/delete failures only mark their own input invalid', async ({ page }) => {
	await page.goto('/settings');

	// A failed create marks only the "add" name field.
	await page.route('**/api/caregivers', async (route) => {
		if (route.request().method() === 'POST') {
			await route.fulfill({
				status: 400,
				contentType: 'application/json',
				body: '{"error":{"code":"validation_failed","issues":[{"path":"name","code":"too_small","message":"too small"}]}}'
			});
			return;
		}
		await route.continue();
	});
	await page.getByLabel('Nom de l’aidant').fill('X');
	await page.getByRole('button', { name: 'Ajouter un aidant' }).click();
	await expect(page.getByRole('alert').filter({ hasText: 'Certains champs sont invalides' })).toBeVisible();
	await expect(page.getByLabel('Nom de l’aidant')).toHaveAttribute('aria-invalid', 'true');
	await page.unroute('**/api/caregivers');

	// Add a real caregiver to edit and delete below.
	await page.getByLabel('Nom de l’aidant').fill('Casque52');
	await page.getByRole('button', { name: 'Ajouter un aidant' }).click();
	await expect(page.getByRole('list').getByText('Casque52')).toBeVisible();
	// The earlier add-failure invalid state is gone now that add succeeded.
	await expect(page.getByLabel('Nom de l’aidant')).not.toHaveAttribute('aria-invalid', 'true');

	// A failed edit marks only the edit field — the untouched "add" field is
	// not also described by this unrelated outcome.
	await page.getByRole('button', { name: 'Modifier Casque52' }).click();
	await page.route('**/api/caregivers/*', async (route) => {
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
	await page.getByLabel('Nouveau nom pour Casque52').fill('Y');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByRole('alert').filter({ hasText: 'Certains champs sont invalides' })).toBeVisible();
	await expect(page.getByLabel('Nouveau nom pour Casque52')).toHaveAttribute('aria-invalid', 'true');
	await expect(page.getByLabel('Nom de l’aidant')).not.toHaveAttribute('aria-invalid', 'true');
	await page.getByRole('button', { name: 'Annuler' }).click();
	await page.unroute('**/api/caregivers/*');

	// A failed delete announces via the alert region only — no input is
	// marked invalid, since delete has no field of its own.
	await page.route('**/api/caregivers/*', async (route) => {
		if (route.request().method() === 'DELETE') {
			await route.fulfill({
				status: 409,
				contentType: 'application/json',
				body: '{"error":{"code":"in_use"}}'
			});
			return;
		}
		await route.continue();
	});
	await page.getByRole('button', { name: 'Supprimer Casque52' }).click();
	await expect(
		page.getByRole('alert').filter({ hasText: 'Impossible : des activités y sont liées.' })
	).toBeVisible();
	await expect(page.getByLabel('Nom de l’aidant')).not.toHaveAttribute('aria-invalid', 'true');
	await page.unroute('**/api/caregivers/*');

	// Clean up the caregiver created by this spec.
	const caregivers = await (await page.request.get('/api/caregivers')).json();
	const created = caregivers.caregivers.find((c: { name: string }) => c.name === 'Casque52');
	if (created) await page.request.delete(`/api/caregivers/${created.id}`);
});
