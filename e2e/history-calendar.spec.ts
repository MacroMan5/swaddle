import { expect, test, type Page } from '@playwright/test';

// Must match dayCalendarLayout.ts — the point of asserting in minutes rather
// than pixels is that a scale change stays a one-line edit here.
const PX_PER_MIN = 20 / 60;

/**
 * Where a block sits on the grid and how tall it is, in minutes since local
 * midnight. Read from layout offsets rather than boundingBox(): the page itself
 * scrolls, so a block early in the day may sit outside the viewport and have a
 * clipped visible rectangle. `offsetTop` is relative to the positioned track.
 */
async function spanMinutesOf(page: Page, eventId: string): Promise<{ start: number; length: number }> {
	const box = await page.evaluate((id) => {
		const el = document.querySelector(`[data-testid="calendar-block"][data-event-id="${id}"]`);
		if (el === null) return null;
		return { top: (el as HTMLElement).offsetTop, height: (el as HTMLElement).offsetHeight };
	}, eventId);
	if (box === null) throw new Error(`no block for ${eventId}`);
	return { start: box.top / PX_PER_MIN, length: box.height / PX_PER_MIN };
}

/** A wall-clock time earlier today, as ISO, plus its minutes-since-midnight. */
function todayAt(hour: number, minute: number): { iso: string; minutes: number } {
	const d = new Date();
	d.setHours(hour, minute, 0, 0);
	return { iso: d.toISOString(), minutes: hour * 60 + minute };
}

test('a durational event lands on its true hour and its true height', async ({ page, request }) => {
	const start = todayAt(3, 15);
	const end = todayAt(4, 45);
	const created = await request.post('/api/events', {
		data: {
			babyId: 'baby-1',
			type: 'sleep',
			startedAt: start.iso,
			endedAt: end.iso,
			details: {}
		}
	});
	const { id } = await created.json();

	await page.goto('/history');
	const block = page.locator(`[data-testid="calendar-block"][data-event-id="${id}"]`);
	await expect(block).toBeAttached();

	const span = await spanMinutesOf(page, id);
	expect(span.start).toBeCloseTo(start.minutes, 0);
	expect(span.length).toBeCloseTo(90, 0); // 90 min, drawn honestly — no floor

	await request.delete(`/api/events/${id}`);
});

test('touching a block opens that event in the edit sheet', async ({ page, request }) => {
	const start = todayAt(2, 0);
	const created = await request.post('/api/events', {
		data: {
			babyId: 'baby-1',
			type: 'bottle',
			startedAt: start.iso,
			details: { milkType: 'formula', volumeMl: 123 }
		}
	});
	const { id } = await created.json();

	await page.goto('/history');
	// A bottle has no duration: it rides the point rail, not a block.
	await page.locator(`[data-testid="calendar-point"][data-event-id="${id}"]`).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(page.getByLabel('Volume (ml)')).toHaveValue('123');

	await page.getByRole('button', { name: 'Fermer' }).or(page.getByRole('button', { name: 'Close' })).first().click();
	await request.delete(`/api/events/${id}`);
});

test('a category chip hides its blocks from the grid, not just its rows', async ({
	page,
	request
}) => {
	const start = todayAt(5, 0);
	const created = await request.post('/api/events', {
		data: {
			babyId: 'baby-1',
			type: 'sleep',
			startedAt: start.iso,
			endedAt: todayAt(6, 0).iso,
			details: {}
		}
	});
	const { id } = await created.json();

	await page.goto('/history');
	const block = page.locator(`[data-testid="calendar-block"][data-event-id="${id}"]`);
	await expect(block).toBeVisible();

	await page.getByRole('button', { name: 'Sommeil', exact: true }).click();
	await expect(block).toHaveCount(0);
	await expect(page.getByTestId('event-row').filter({ hasText: 'Sommeil' })).toHaveCount(0);

	await request.delete(`/api/events/${id}`);
});

test('a running timer is drawn open and bounded by the current time', async ({ page, request }) => {
	// Started 90 minutes ago, so the block's real height dominates the
	// minimum-height floor and "ends at now" is what is actually measured.
	const startedAt = new Date(Date.now() - 90 * 60_000).toISOString();
	await request.post('/api/timers/sleep/start', { data: { babyId: 'baby-1', startedAt } });
	try {
		await page.goto('/history');
		const open = page.locator('[data-testid="calendar-block"][data-open="true"]');
		await expect(open).toBeAttached();
		const id = (await open.getAttribute('data-event-id')) as string;
		const span = await spanMinutesOf(page, id);
		// It must stop at "now", never run to the bottom of the day.
		const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
		expect(span.start + span.length).toBeLessThanOrEqual(nowMin + 2);
	} finally {
		// Stopping turns the timer into a completed sleep event; leaving it
		// behind would make it the earliest row of the day for every later spec.
		const stopped = await request.post('/api/timers/sleep/stop', { data: { babyId: 'baby-1' } });
		if (stopped.ok()) await request.delete(`/api/events/${(await stopped.json()).id}`);
	}
});

for (const width of [320, 375]) {
	test(`the grid never scrolls sideways at ${width}px`, async ({ page, request }) => {
		// Two overlapping events force the two-column packing, the widest case.
		const nap = await request.post('/api/events', {
			data: {
				babyId: 'baby-1',
				type: 'sleep',
				startedAt: todayAt(1, 0).iso,
				endedAt: todayAt(3, 0).iso,
				details: {}
			}
		});
		const feed = await request.post('/api/events', {
			data: {
				babyId: 'baby-1',
				type: 'nursing',
				startedAt: todayAt(1, 30).iso,
				endedAt: todayAt(1, 50).iso,
				details: { segments: [{ side: 'left', startedAt: todayAt(1, 30).iso, endedAt: todayAt(1, 50).iso }] }
			}
		});

		await page.setViewportSize({ width, height: 800 });
		await page.goto('/history');
		await expect(page.getByTestId('calendar-track')).toBeAttached();

		const overflow = await page.evaluate(() => {
			const track = document.querySelector('[data-testid="calendar-track"]') as HTMLElement;
			return {
				page: document.documentElement.scrollWidth - window.innerWidth,
				grid: track.scrollWidth - track.clientWidth,
				// The grid must never scroll vertically either: the whole point is
				// that a day is one screen.
				height: track.getBoundingClientRect().height
			};
		});
		expect(overflow.page).toBeLessThanOrEqual(0);
		expect(overflow.grid).toBeLessThanOrEqual(0);
		expect(overflow.height).toBe(480);

		await request.delete(`/api/events/${(await nap.json()).id}`);
		await request.delete(`/api/events/${(await feed.json()).id}`);
	});
}
