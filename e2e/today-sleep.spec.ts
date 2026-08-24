import { expect, test } from '@playwright/test';

test.afterEach(async ({ request }) => {
	for (const type of ['nursing', 'pump', 'sleep'])
		await request.post(`/api/timers/${type}/stop`, {
			data: { babyId: 'baby-1', ...(type === 'pump' ? { volumeMl: 10 } : {}) }
		});
});

test('AC-005: a started sleep survives a reload with correct server-based elapsed', async ({
	page,
	request
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Commencer le sommeil' }).click();
	const active = page.getByTestId('active-timers');
	await expect(active).toContainText('Sommeil');

	await page.reload();
	await expect(page.getByTestId('active-timers')).toContainText('Sommeil');
	// The clock shows a small positive elapsed, computed from the server start.
	await expect(page.getByTestId('active-timers')).toContainText(/00:0\d/);

	await page.getByRole('button', { name: 'Réveillé' }).click();
	await expect(page.getByTestId('active-timers')).toBeHidden();
	const { timers } = await (await request.get('/api/timers?babyId=baby-1')).json();
	expect(timers).toHaveLength(0);
});
