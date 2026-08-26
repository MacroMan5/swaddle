import { expect, test, type APIRequestContext } from '@playwright/test';

// Issue #44: the household's volume unit is presentation. Storage, the API and
// the exports stay in canonical integer millilitres whatever is selected, and
// switching the preference never rewrites an event.
//
// The specs share one server (`workers: 1`), so each one picks a volume whose
// ounce rendering no other spec produces, and hands the household back on `ml`.

test.afterEach(async ({ request }) => {
	await request.patch('/api/household', { data: { volumeUnit: 'ml' } });
});

/** A bottle created now, straight through the API in canonical millilitres. */
async function createBottleMl(request: APIRequestContext, volumeMl: number): Promise<string> {
	const res = await request.post('/api/events', {
		data: {
			babyId: 'baby-1',
			type: 'bottle',
			startedAt: new Date().toISOString(),
			details: { milkType: 'formula', volumeMl }
		}
	});
	expect(res.status()).toBe(201);
	return (await res.json()).id;
}

/** What the server holds for `id`, in canonical millilitres. */
async function storedVolumeMl(request: APIRequestContext, id: string): Promise<number | undefined> {
	const { events } = await (await request.get('/api/events?babyId=baby-1')).json();
	return events.find((e: { id: string }) => e.id === id)?.details.volumeMl;
}

test('#44: switching to oz relabels every surface without touching the stored millilitres', async ({
	page,
	request
}) => {
	// 87 ml renders as "2,9 oz" — a value no other spec produces.
	const id = await createBottleMl(request, 87);

	await page.goto('/settings');
	await page.getByRole('button', { name: 'oz', exact: true }).click();
	await expect
		.poll(async () => (await (await page.request.get('/api/household')).json()).volumeUnit)
		.toBe('oz');

	// Today: recent activity, the quick-action hint and the day summary.
	await page.goto('/');
	await expect(page.getByText('Biberon · 2,9 oz')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Biberon' })).toContainText('2,9 oz');
	// The day summary is the only definition list on Today.
	await expect(page.locator('dl')).toContainText('oz');

	// The bottle sheet: label, step buttons and presets are all in ounces.
	await page.getByRole('button', { name: 'Biberon' }).click();
	await expect(page.getByLabel('Volume (oz)')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Moins 0,5 oz' })).toBeVisible();
	await expect(page.getByRole('button', { name: '3,0', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Plus 0,5 oz' }).click();
	await expect(page.getByLabel('Volume (oz)')).toHaveValue('0,5');

	// History says the same thing as Today about the same event.
	await page.goto('/history');
	await expect(page.getByTestId('event-row').filter({ hasText: '2,9 oz' })).toHaveCount(1);

	// Nothing about the stored event moved.
	expect(await storedVolumeMl(request, id)).toBe(87);
});

test('#44: an ounce entry converts to the nearest whole millilitre and obeys the canonical bounds', async ({
	page,
	request
}) => {
	await request.patch('/api/household', { data: { volumeUnit: 'oz' } });

	await page.goto('/');
	await page.getByRole('button', { name: 'Biberon' }).click();
	await page.getByRole('button', { name: 'Préparation' }).click();
	await page.getByLabel('Volume (oz)').fill('4,5');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByRole('status').last()).toContainText('Biberon');

	// 4,5 oz × 29,5735… = 133,08 ml → stored as the integer 133.
	await expect(page.getByText('Biberon · 4,5 oz')).toBeVisible();
	const { events } = await (await request.get('/api/events?babyId=baby-1')).json();
	const created = events.filter(
		(e: { type: string; details: { volumeMl?: number } }) =>
			e.type === 'bottle' && e.details.volumeMl === 133
	);
	expect(created).toHaveLength(1);

	// Over the canonical 1000 ml ceiling: the copy quotes the ounce bounds.
	await page.getByRole('button', { name: 'Biberon' }).click();
	await page.getByLabel('Volume (oz)').fill('40');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByText('Le volume ne peut pas dépasser 33,8 oz.')).toBeVisible();
});

test('#44: editing in oz leaves an untouched volume exactly as stored, and converts a real edit once', async ({
	page,
	request
}) => {
	// 150 ml renders as "5,1 oz"; converting that back would land on 151 ml.
	const id = await createBottleMl(request, 150);
	await request.patch('/api/household', { data: { volumeUnit: 'oz' } });

	await page.goto('/history');
	const row = page.getByTestId('event-row').filter({ hasText: '5,1 oz' });
	await expect(row).toHaveCount(1);
	await row.click();
	await expect(page.getByLabel('Volume (oz)')).toHaveValue('5,1');

	// Saved without touching the field: the stored millilitres must not move.
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByTestId('event-row').filter({ hasText: '5,1 oz' })).toHaveCount(1);
	expect(await storedVolumeMl(request, id)).toBe(150);

	// A real edit converts once: 6,0 oz → 177 ml, shown back as "6,0 oz".
	await page.getByTestId('event-row').filter({ hasText: '5,1 oz' }).click();
	await expect(page.getByLabel('Volume (oz)')).toHaveValue('5,1');
	await page.getByLabel('Volume (oz)').fill('6,0');
	// The sheet must not re-initialise mid-entry (review P1): give the clock a
	// tick before saving, so a reset would be caught here rather than silently
	// saving the old value.
	await page.waitForTimeout(1500);
	await expect(page.getByLabel('Volume (oz)')).toHaveValue('6,0');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByTestId('event-row').filter({ hasText: '6,0 oz' })).toHaveCount(1);
	expect(await storedVolumeMl(request, id)).toBe(177);
});

test('#44: exports stay canonical in oz mode, and a restore preserves the household preference', async ({
	request
}) => {
	const id = await createBottleMl(request, 90);
	await request.patch('/api/household', { data: { volumeUnit: 'oz' } });

	const exported = await (await request.get('/api/export/json')).json();
	expect(exported.household.volumeUnit).toBe('oz');
	const exportedBottle = exported.events.find((e: { id: string }) => e.id === id);
	// Canonical, integer, and named volumeMl — never a converted ounce value.
	expect(exportedBottle.details).toEqual({ milkType: 'formula', volumeMl: 90 });
	expect(Number.isInteger(exportedBottle.details.volumeMl)).toBe(true);

	const csv = await (await request.get('/api/export/csv')).text();
	expect(csv).toContain('volumeMl');
	expect(csv).not.toContain('volumeOz');

	// A restore brings the preference back with the data, and the events with it.
	await request.patch('/api/household', { data: { volumeUnit: 'ml' } });
	const restore = await request.post('/api/restore', { data: exported });
	expect(restore.ok()).toBeTruthy();
	expect((await (await request.get('/api/household')).json()).volumeUnit).toBe('oz');

	const after = await (await request.get('/api/export/json')).json();
	expect(after.events).toEqual(exported.events);
});
