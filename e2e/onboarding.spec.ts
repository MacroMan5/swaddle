import { expect, test } from '@playwright/test';

const B = 'http://localhost:3001';

test('AC-008: empty db redirects to the wizard; baby + caregiver make the app usable', async ({ page }) => {
	await page.goto(`${B}/`);
	await expect(page).toHaveURL(`${B}/setup`);
	await page.getByLabel('Prénom').fill('Léa');
	await page.getByLabel('Date de naissance').fill('2026-08-01');
	await page.getByRole('button', { name: 'Continuer' }).click();
	// Step 2 mounts once the baby-creation fetch resolves; wait for it so this
	// fill doesn't race the still-mounted step-1 "Prénom" field.
	await expect(page.getByRole('button', { name: 'Terminer' })).toBeVisible();

	// Wizard state is otherwise client-only: a reload mid-wizard must resume at
	// step 2 (the baby load already happened server-side) instead of posting a
	// second baby.
	await page.reload();
	await expect(page.getByRole('button', { name: 'Terminer' })).toBeVisible();
	const babiesAfterReload = await (await page.request.get(`${B}/api/babies`)).json();
	expect(babiesAfterReload.babies).toHaveLength(1);

	await page.getByLabel('Prénom').fill('Camille');
	await page.getByRole('button', { name: 'Terminer' }).click();
	await expect(page).toHaveURL(`${B}/`);
	const caregiverId = await page.evaluate(() => localStorage.getItem('swaddle.caregiverId'));
	expect(caregiverId).toBeTruthy();
	const health = await page.request.get(`${B}/api/health`);
	expect((await health.json()).setupComplete).toBe(true);
});
