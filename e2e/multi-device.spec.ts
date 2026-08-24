import { expect, test } from '@playwright/test';

test.afterEach(async ({ request }) => {
	for (const type of ['nursing', 'pump', 'sleep'])
		await request.post(`/api/timers/${type}/stop`, {
			data: { babyId: 'baby-1', ...(type === 'pump' ? { volumeMl: 10 } : {}) }
		});
});

test('AC-003: sleep started on device A is visible and stoppable on device B; A sees the end in < 2 s', async ({
	browser,
	request
}) => {
	const ctxA = await browser.newContext();
	const ctxB = await browser.newContext();
	const pageA = await ctxA.newPage();
	const pageB = await ctxB.newPage();

	await pageA.goto('/');
	await pageA.getByRole('button', { name: 'Commencer le sommeil' }).click();
	await expect(pageA.getByTestId('active-timers')).toContainText('Sommeil');

	// Device B opens the app and sees the running timer (server state, not local).
	await pageB.goto('/');
	await expect(pageB.getByTestId('active-timers')).toContainText('Sommeil');

	// B stops it; A must see the end within the NFR-001 budget (2 s).
	await pageB.getByRole('button', { name: 'Réveillé' }).click();
	await expect(pageA.getByTestId('active-timers')).toBeHidden({ timeout: 2000 });

	await ctxA.close();
	await ctxB.close();
	const { timers } = await (await request.get('/api/timers?babyId=baby-1')).json();
	expect(timers).toHaveLength(0);
});
