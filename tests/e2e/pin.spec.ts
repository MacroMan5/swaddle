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

test('brute-force throttle: 5 wrong PINs lock out further attempts for a while', async ({
	request
}) => {
	await request.put(`${B}/api/household/pin`, { data: { pin: '4321' } });

	for (let i = 0; i < 5; i++) {
		const res = await request.post(`${B}/api/auth/pin`, { data: { pin: '0000' } });
		expect(res.status()).toBe(403);
	}
	const locked = await request.post(`${B}/api/auth/pin`, { data: { pin: '4321' } });
	expect(locked.status()).toBe(429);
	expect((await locked.json()).error.code).toBe('too_many_attempts');

	// Disabling the pin goes through /api/household/pin, not /api/auth/pin, so
	// it is unaffected by the lockout — leaves server B unlocked for later specs.
	const disable = await request.delete(`${B}/api/household/pin`, {
		data: { currentPin: '4321' }
	});
	expect(disable.ok()).toBeTruthy();
});
