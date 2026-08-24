import { expect, test } from '@playwright/test';

const B = 'http://localhost:3001';

// Runs on server B, after onboarding.spec.ts (alphabetical order under
// workers: 1) has completed setup there.
test('AC-009: pin unlock with a persistent per-device session', async ({ request, browser }) => {
	const health = await (await request.get(`${B}/api/health`)).json();
	expect(health.setupComplete).toBe(true);

	await request.put(`${B}/api/household/pin`, { data: { pin: '1234' } });

	// A fresh browser context has no cookies: it must be redirected to /pin.
	const context = await browser.newContext();
	const lockedPage = await context.newPage();
	await lockedPage.goto(`${B}/`);
	await expect(lockedPage).toHaveURL(`${B}/pin`);

	await lockedPage.getByLabel('Code PIN').fill('9999');
	await lockedPage.getByRole('button', { name: 'Déverrouiller' }).click();
	await expect(lockedPage.getByText('Code incorrect')).toBeVisible();
	await expect(lockedPage).toHaveURL(`${B}/pin`);

	await lockedPage.getByLabel('Code PIN').fill('1234');
	await lockedPage.getByRole('button', { name: 'Déverrouiller' }).click();
	await expect(lockedPage).toHaveURL(`${B}/`);

	await lockedPage.reload();
	await expect(lockedPage).toHaveURL(`${B}/`); // persistent session (AC-009)

	// Leave server B unlocked for later specs.
	const disable = await lockedPage.request.delete(`${B}/api/household/pin`, {
		data: { currentPin: '1234' }
	});
	expect(disable.ok()).toBeTruthy();

	await context.close();
});
