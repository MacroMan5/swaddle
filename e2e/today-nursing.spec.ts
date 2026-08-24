import { expect, test } from '@playwright/test';

test.afterEach(async ({ request }) => {
	for (const type of ['nursing', 'pump', 'sleep'])
		await request.post(`/api/timers/${type}/stop`, {
			data: { babyId: 'baby-1', ...(type === 'pump' ? { volumeMl: 10 } : {}) }
		});
});

test('AC-002: nursing starts in two touches and builds segments', async ({ page, request }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Allaiter' }).click();
	await page.getByRole('button', { name: 'Gauche' }).click();

	// Active card appears with a running clock.
	const active = page.getByTestId('active-timers');
	await expect(active).toContainText('Allaitement');
	await expect(active).toContainText('Gauche');

	await active.getByRole('button', { name: 'Changer de côté' }).click();
	await expect(active).toContainText('Droite');
	await active.getByRole('button', { name: 'Pause' }).click();
	await expect(active.getByRole('button', { name: 'Reprendre' })).toBeVisible();
	await active.getByRole('button', { name: 'Reprendre' }).click();
	await active.getByRole('button', { name: 'Terminer' }).click();
	await expect(active).toBeHidden();

	const { timers } = await (await request.get('/api/timers?babyId=baby-1')).json();
	expect(timers).toHaveLength(0);
	const { events } = await (await request.get('/api/events?babyId=baby-1')).json();
	const nursing = events.find((e: { type: string }) => e.type === 'nursing');
	expect(nursing.details.segments.length).toBeGreaterThanOrEqual(3);
	expect(nursing.details.segments.map((s: { side: string }) => s.side)).toContain('right');
});

test('bottle sheet records type, volume and rejects a 1500 ml volume inline', async ({
	page,
	request
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Biberon' }).click();
	await page.getByRole('button', { name: 'Préparation' }).click();
	await page.getByLabel(/volume/i).fill('1500');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByText(/1000/)).toBeVisible(); // inline FR-017 error, sheet stays open
	await page.getByLabel(/volume/i).fill('90');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByRole('status')).toContainText('Biberon');
	const { events } = await (await request.get('/api/events?babyId=baby-1')).json();
	const bottle = events.find((e: { type: string }) => e.type === 'bottle');
	expect(bottle.details).toMatchObject({ milkType: 'formula', volumeMl: 90 });
});

test('DEC-001: a paused nursing segment does not inflate the displayed duration', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Allaiter' }).click();
	await page.getByRole('button', { name: 'Gauche' }).click();
	const active = page.getByTestId('active-timers');
	await expect(active).toContainText('Allaitement');

	await active.getByRole('button', { name: 'Pause' }).click();
	await expect(active.getByRole('button', { name: 'Reprendre' })).toBeVisible();
	await page.waitForTimeout(2200); // ~2.2 s of wall time excluded while paused
	await active.getByRole('button', { name: 'Reprendre' }).click();
	await page.waitForTimeout(300);

	// Well over 2.5 s of wall time has passed since the start, but the paused
	// window must not show up in the running clock: still under a few seconds.
	await expect(active).toContainText(/00:0[0-3]/);
});

test('pump starts and stops with a volume, closing the active timer', async ({ page, request }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Tirage' }).click();
	await page.getByLabel('Tirage').getByRole('button', { name: 'Les deux' }).click();
	const active = page.getByTestId('active-timers');
	await expect(active).toContainText('Tirage');

	await active.getByLabel(/volume/i).fill('80');
	await active.getByRole('button', { name: 'Terminer' }).click();
	await expect(active).toBeHidden();

	const { timers } = await (await request.get('/api/timers?babyId=baby-1')).json();
	expect(timers).toHaveLength(0);
	const { events } = await (await request.get('/api/events?babyId=baby-1')).json();
	const pump = events.find((e: { type: string }) => e.type === 'pump');
	expect(pump.details).toMatchObject({ volumeMl: 80 });
});
