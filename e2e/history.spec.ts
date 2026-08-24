import { expect, test } from '@playwright/test';

test('day view lists events chronologically with summary; filters work', async ({
	page,
	request
}) => {
	// Minutes-ago offsets (not fixed clock hours): always in the past regardless
	// of what local time the test happens to run at.
	const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
	await request.post('/api/events', {
		data: { babyId: 'baby-1', type: 'diaper', startedAt: minutesAgo(4), details: { pee: true, poo: false } }
	});
	await request.post('/api/events', {
		data: {
			babyId: 'baby-1',
			type: 'bottle',
			startedAt: minutesAgo(2),
			details: { milkType: 'formula', volumeMl: 90 }
		}
	});

	await page.goto('/history');
	const rows = page.getByTestId('event-row');
	await expect(rows.first()).toContainText('Couche');
	await expect(page.getByTestId('day-summary')).toContainText('90');

	// Chips are independent multi-toggles, all on by default: turning off
	// Alimentation and Couche hides this test's own bottle/diaper rows (other
	// e2e specs may have left same-day sleep events under `workers: 1`, so this
	// asserts on our own rows rather than an absolute count).
	await page.getByRole('button', { name: 'Alimentation', exact: true }).click();
	await page.getByRole('button', { name: 'Couche', exact: true }).click();
	await expect(page.getByTestId('event-row').filter({ hasText: 'Biberon' })).toHaveCount(0);
	await expect(page.getByTestId('event-row').filter({ hasText: 'Couche' })).toHaveCount(0);
});

test('history "today" reacts to the server-corrected clock, not a frozen local Date (review P2)', async ({
	page
}) => {
	// A serverTime one full day ahead of whatever the browser's own clock
	// says: before the fix, todayKey was `localDayKey(new Date())`, computed
	// once at mount and never revisited, so RISK-001's server-corrected clock
	// (store.nowMs) had no effect on it — the picker would keep calling the
	// day it mounted on "today" forever, even past a real local midnight.
	const serverTomorrow = new Date(Date.now() + 24 * 3_600_000);
	await page.route('**/api/stream', async (route) => {
		await route.fulfill({
			status: 200,
			headers: { 'content-type': 'text/event-stream' },
			body: `event: snapshot\ndata: ${JSON.stringify({ serverTime: serverTomorrow.toISOString(), activeTimers: [] })}\n\n`
		});
	});

	await page.goto('/history');

	// The page mounted with the browser's "today" as the selected day; once
	// the mocked snapshot corrects the clock to a day ahead, that selected day
	// is no longer "today" from the server's point of view, so the next-day
	// arrow must re-enable — without a reload.
	await expect(page.getByRole('button', { name: 'Jour suivant' })).toBeEnabled();
});

test('day picker navigates to yesterday (empty) and back', async ({ page }) => {
	await page.goto('/history');
	await page.getByRole('button', { name: 'Jour précédent' }).click();
	await expect(page.getByText('Aucune activité ce jour-là.')).toBeVisible();
	await page.getByRole('button', { name: 'Jour suivant' }).click();
	await expect(page.getByTestId('event-row').first()).toBeVisible();
});

test('week view shows 7 columns with today’s bottle total; a column jumps back to day view', async ({
	page,
	request
}) => {
	await request.post('/api/events', {
		data: {
			babyId: 'baby-1',
			type: 'bottle',
			startedAt: new Date(Date.now() - 60_000).toISOString(),
			details: { milkType: 'formula', volumeMl: 120 }
		}
	});

	await page.goto('/history');
	await page.getByRole('button', { name: 'Semaine', exact: true }).click();

	const columns = page.getByTestId('week-col');
	await expect(columns).toHaveCount(7);

	// Week starts Monday; map today's JS weekday (0=Sun..6=Sat) to that column.
	const jsDay = new Date().getDay();
	const todayIndex = jsDay === 0 ? 6 : jsDay - 1;
	const todayColumn = columns.nth(todayIndex);
	await expect(todayColumn).toContainText(/\d+ ml/);

	// Tapping today's column returns to the day view.
	await todayColumn.click();
	await expect(page.getByRole('button', { name: 'Jour', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.getByTestId('event-row').first()).toBeVisible();
});
