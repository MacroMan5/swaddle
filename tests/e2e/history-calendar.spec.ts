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

/**
 * A wall-clock time on *yesterday's* date, as ISO, plus its minutes-since-midnight.
 *
 * Seeding "today" at a fixed clock hour is a landmine: between local midnight
 * and that hour, the time is still in the future and the server rejects it
 * (FR-017). Anchoring to yesterday instead is always safely in the past no
 * matter what time the suite runs, with no branching on the current hour —
 * the tests below navigate the day selector back one day to see it.
 */
function yesterdayAt(hour: number, minute: number): { iso: string; minutes: number } {
	const d = new Date();
	d.setDate(d.getDate() - 1);
	d.setHours(hour, minute, 0, 0);
	return { iso: d.toISOString(), minutes: hour * 60 + minute };
}

/** Navigate `/history` to yesterday via the day selector's previous-day chevron. */
async function goToYesterday(page: Page): Promise<void> {
	await page.goto('/history');
	await page.getByRole('button', { name: 'Jour précédent' }).click();
}

/** POST an event and fail fast (with the server's actual error) instead of an `undefined` id. */
async function expectCreated(response: {
	ok(): boolean;
	status(): number;
	json(): Promise<unknown>;
}): Promise<{ id: string }> {
	const body = (await response.json()) as { id?: string; error?: unknown };
	expect(response.ok(), `event creation failed (${response.status()}): ${JSON.stringify(body)}`).toBe(
		true
	);
	expect(body.id).toBeTruthy();
	return { id: body.id as string };
}

test('a durational event lands on its true hour and its true height', async ({ page, request }) => {
	const start = yesterdayAt(3, 15);
	const end = yesterdayAt(4, 45);
	const created = await request.post('/api/events', {
		data: {
			babyId: 'baby-1',
			type: 'sleep',
			startedAt: start.iso,
			endedAt: end.iso,
			details: {}
		}
	});
	const { id } = await expectCreated(created);

	await goToYesterday(page);
	const block = page.locator(`[data-testid="calendar-block"][data-event-id="${id}"]`);
	await expect(block).toBeAttached();

	const span = await spanMinutesOf(page, id);
	expect(span.start).toBeCloseTo(start.minutes, 0);
	expect(span.length).toBeCloseTo(90, 0); // 90 min, drawn honestly — no floor

	await request.delete(`/api/events/${id}`);
});

test('touching a block opens that event in the edit sheet', async ({ page, request }) => {
	const start = yesterdayAt(2, 0);
	const created = await request.post('/api/events', {
		data: {
			babyId: 'baby-1',
			type: 'bottle',
			startedAt: start.iso,
			details: { milkType: 'formula', volumeMl: 123 }
		}
	});
	const { id } = await expectCreated(created);

	await goToYesterday(page);
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
	const start = yesterdayAt(5, 0);
	const created = await request.post('/api/events', {
		data: {
			babyId: 'baby-1',
			type: 'sleep',
			startedAt: start.iso,
			endedAt: yesterdayAt(6, 0).iso,
			details: {}
		}
	});
	const { id } = await expectCreated(created);

	await goToYesterday(page);
	const block = page.locator(`[data-testid="calendar-block"][data-event-id="${id}"]`);
	await expect(block).toBeVisible();

	await page.getByRole('button', { name: 'Sommeil', exact: true }).click();
	await expect(block).toHaveCount(0);
	await expect(page.getByTestId('event-row').filter({ hasText: 'Sommeil' })).toHaveCount(0);

	await request.delete(`/api/events/${id}`);
});

test('a running timer is drawn open and bounded by the current time', async ({ page, request }) => {
	// Started 90 minutes ago, so the block's real height dominates the
	// minimum-height floor and "ends at now" is what is actually measured —
	// except right after local midnight: a start 90 minutes ago is clipped to
	// the top of today's grid (dayCalendarLayout's `clippedTop`), so the
	// visible span becomes "midnight to now", which can be under the grid's
	// own 15-minute minimum-block floor (MIN_BLOCK_MIN in dayCalendarLayout.ts)
	// in the first ~15 minutes of a new day. The extra tolerance below is only
	// granted in that clipped case, so a real drift bug still fails tightly
	// outside the midnight window.
	const startDate = new Date(Date.now() - 90 * 60_000);
	const startedAt = startDate.toISOString();
	const started = await request.post('/api/timers/sleep/start', {
		data: { babyId: 'baby-1', startedAt }
	});
	expect(started.ok(), `timer start failed (${started.status()})`).toBe(true);
	try {
		await page.goto('/history');
		const open = page.locator('[data-testid="calendar-block"][data-open="true"]');
		await expect(open).toBeAttached();
		const id = (await open.getAttribute('data-event-id')) as string;
		const span = await spanMinutesOf(page, id);
		// It must stop at "now" (plus the grid's own 15-minute floor, but only
		// when the timer's true start fell on the previous day and got clipped
		// to the top of today's grid), never run to the bottom of the day.
		const MIN_BLOCK_MIN = 15;
		const now = new Date();
		const clippedAtMidnight = startDate.toDateString() !== now.toDateString();
		const nowMin = now.getHours() * 60 + now.getMinutes();
		const tolerance = clippedAtMidnight ? MIN_BLOCK_MIN + 2 : 2;
		expect(span.start + span.length).toBeLessThanOrEqual(nowMin + tolerance);
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
				startedAt: yesterdayAt(1, 0).iso,
				endedAt: yesterdayAt(3, 0).iso,
				details: {}
			}
		});
		const feed = await request.post('/api/events', {
			data: {
				babyId: 'baby-1',
				type: 'nursing',
				startedAt: yesterdayAt(1, 30).iso,
				endedAt: yesterdayAt(1, 50).iso,
				details: {
					segments: [
						{ side: 'left', startedAt: yesterdayAt(1, 30).iso, endedAt: yesterdayAt(1, 50).iso }
					]
				}
			}
		});
		const { id: napId } = await expectCreated(nap);
		const { id: feedId } = await expectCreated(feed);

		await page.setViewportSize({ width, height: 800 });
		await goToYesterday(page);
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

		await request.delete(`/api/events/${napId}`);
		await request.delete(`/api/events/${feedId}`);
	});
}
