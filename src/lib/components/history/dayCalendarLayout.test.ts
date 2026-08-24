// Timezone matters: every assertion below is about local wall-clock placement.
process.env.TZ = 'America/Toronto';

import { describe, it, expect } from 'vitest';
import {
	placeBlocks,
	placePoints,
	HOUR_HEIGHT_PX,
	PX_PER_MIN,
	MIN_BLOCK_PX,
	DAY_HEIGHT_PX
} from './dayCalendarLayout';
import type { EventDTO, EventType } from '$lib/client/types';

let seq = 0;

/** Builds a DTO from local wall-clock times, the way the grid reads them. */
function ev(
	type: EventType,
	start: Date,
	end: Date | null,
	details: EventDTO['details'] = {} as EventDTO['details']
): EventDTO {
	return {
		id: `e${++seq}`,
		babyId: 'baby-1',
		caregiverId: null,
		type,
		startedAt: start.toISOString(),
		endedAt: end === null ? null : end.toISOString(),
		note: null,
		details,
		createdAt: start.toISOString(),
		updatedAt: start.toISOString(),
		deletedAt: null
	};
}

const D = (h: number, m = 0, day = 24) => new Date(2026, 7, day, h, m);
const DAY = '2026-08-24';

describe('placeBlocks — position', () => {
	it('maps wall-clock minutes to pixels at the declared scale', () => {
		const [p] = placeBlocks([ev('sleep', D(7, 15), D(7, 45))], DAY, D(12).getTime());
		expect(p.topPx).toBe((7 * 60 + 15) * PX_PER_MIN);
		expect(p.heightPx).toBe(30 * PX_PER_MIN);
		expect(p.heightPx).toBeGreaterThan(MIN_BLOCK_PX); // drawn honestly, no floor
	});

	it('fits a whole day on one screen', () => {
		// The reason this view exists: 24 h readable without scrolling.
		expect(DAY_HEIGHT_PX).toBeLessThanOrEqual(520);
	});

	it('draws a 15-minute feed at its true height, right at the floor', () => {
		const [p] = placeBlocks([ev('nursing', D(9), D(9, 15))], DAY, D(12).getTime());
		expect(p.heightPx).toBe(MIN_BLOCK_PX);
		expect(15 * PX_PER_MIN).toBe(MIN_BLOCK_PX);
	});

	it('floors a very short session so it stays visible at all', () => {
		const [p] = placeBlocks([ev('nursing', D(9), D(9, 3))], DAY, D(12).getTime());
		expect(p.heightPx).toBe(MIN_BLOCK_PX);
	});

	it('a full hour is exactly one row', () => {
		const [p] = placeBlocks([ev('sleep', D(13), D(14))], DAY, D(20).getTime());
		expect(p.heightPx).toBe(HOUR_HEIGHT_PX);
	});
});

describe('placeBlocks — overlap packing', () => {
	it('gives disjoint events the full width', () => {
		const placed = placeBlocks(
			[ev('nursing', D(7), D(7, 30)), ev('sleep', D(9), D(10))],
			DAY,
			D(12).getTime()
		);
		expect(placed.map((p) => p.columns)).toEqual([1, 1]);
		expect(placed.map((p) => p.column)).toEqual([0, 0]);
	});

	it('splits a feed nested inside a nap into two columns, nap on the left', () => {
		const nap = ev('sleep', D(13), D(16));
		const feed = ev('nursing', D(14), D(14, 20));
		const placed = placeBlocks([feed, nap], DAY, D(20).getTime());
		const byId = Object.fromEntries(placed.map((p) => [p.event.id, p]));
		expect(byId[nap.id]).toMatchObject({ column: 0, columns: 2 });
		expect(byId[feed.id]).toMatchObject({ column: 1, columns: 2 });
	});

	it('opens a third column only for genuinely simultaneous events', () => {
		const placed = placeBlocks(
			[ev('sleep', D(13), D(16)), ev('nursing', D(14), D(15)), ev('pump', D(14, 30), D(15, 30))],
			DAY,
			D(20).getTime()
		);
		expect(new Set(placed.map((p) => p.columns))).toEqual(new Set([3]));
		expect(new Set(placed.map((p) => p.column))).toEqual(new Set([0, 1, 2]));
	});

	it('reuses a freed column instead of widening the cluster', () => {
		// Two short feeds back to back inside one long nap: the second reuses
		// the first's column, so the cluster stays at two columns, not three.
		const placed = placeBlocks(
			[ev('sleep', D(13), D(17)), ev('nursing', D(14), D(14, 30)), ev('nursing', D(15), D(15, 30))],
			DAY,
			D(20).getTime()
		);
		expect(new Set(placed.map((p) => p.columns))).toEqual(new Set([2]));
	});

	it('keeps separate clusters from contaminating each other', () => {
		const placed = placeBlocks(
			[
				ev('sleep', D(1), D(3)),
				ev('nursing', D(2), D(2, 20)), // cluster A: 2 columns
				ev('sleep', D(9), D(10)) // cluster B: alone
			],
			DAY,
			D(12).getTime()
		);
		const lonely = placed.find((p) => p.topPx === 9 * HOUR_HEIGHT_PX);
		expect(lonely?.columns).toBe(1);
	});

	it('packs on the drawn height, so a floored block never sits under another', () => {
		// A 2-minute session is drawn 15 minutes tall; a feed starting 5 minutes
		// later must therefore still be treated as overlapping it.
		const placed = placeBlocks(
			[ev('nursing', D(8), D(8, 2)), ev('pump', D(8, 5), D(8, 25))],
			DAY,
			D(12).getTime()
		);
		expect(new Set(placed.map((p) => p.columns))).toEqual(new Set([2]));
	});
});

describe('placeBlocks — midnight and running timers', () => {
	it('clips a carry-over to the top of the grid and flags it', () => {
		const [p] = placeBlocks([ev('sleep', D(23, 30, 23), D(1, 30))], DAY, D(12).getTime());
		expect(p.topPx).toBe(0);
		expect(p.clippedTop).toBe(true);
		expect(p.clippedBottom).toBe(false);
		expect(p.heightPx).toBe(90 * PX_PER_MIN); // 00:00 → 01:30
	});

	it('clips a spillover to the bottom of the grid and flags it', () => {
		const [p] = placeBlocks([ev('sleep', D(23, 30), D(1, 30, 25))], DAY, D(23, 45).getTime());
		expect(p.topPx).toBe((23 * 60 + 30) * PX_PER_MIN);
		expect(p.topPx + p.heightPx).toBe(1440 * PX_PER_MIN);
		expect(p.clippedTop).toBe(false);
		expect(p.clippedBottom).toBe(true);
	});

	it('does not call a session that truly began at 00:00 a carry-over', () => {
		const [p] = placeBlocks([ev('sleep', D(0, 0), D(2))], DAY, D(12).getTime());
		expect(p.topPx).toBe(0);
		expect(p.clippedTop).toBe(false);
	});

	it('bounds a running timer at nowMs and flags it open', () => {
		const now = D(14, 20).getTime();
		const [p] = placeBlocks([ev('sleep', D(13), null)], DAY, now);
		expect(p.open).toBe(true);
		expect(p.heightPx).toBe(80 * PX_PER_MIN);
	});
});

describe('placeBlocks — DST (the reason positions read the wall clock)', () => {
	it('spring-forward: 23:30 still sits at 23.5 h on a 23-hour day', () => {
		const key = '2026-03-08';
		const start = new Date(2026, 2, 8, 23, 30);
		const [p] = placeBlocks(
			[ev('sleep', start, new Date(2026, 2, 8, 23, 50))],
			key,
			new Date(2026, 2, 9, 2).getTime()
		);
		expect(p.topPx).toBe((23 * 60 + 30) * PX_PER_MIN);
	});

	it('fall-back: 23:30 is not clamped to the bottom on a 25-hour day', () => {
		const key = '2026-11-01';
		const start = new Date(2026, 10, 1, 23, 30);
		const [p] = placeBlocks(
			[ev('sleep', start, new Date(2026, 10, 1, 23, 50))],
			key,
			new Date(2026, 10, 2, 2).getTime()
		);
		expect(p.topPx).toBe((23 * 60 + 30) * PX_PER_MIN);
		expect(p.topPx).toBeLessThan(1440 * PX_PER_MIN);
	});
});

describe('placePoints', () => {
	const bottle = ev('bottle', D(9, 30), null, { milkType: 'formula', volumeMl: 90 });
	const diaper = ev('diaper', D(8), null, { pee: true, poo: false });

	it('positions bottles and diapers without a height', () => {
		const points = placePoints([bottle, diaper], DAY, D(12).getTime());
		expect(points.map((p) => p.event.id)).toEqual([diaper.id, bottle.id]); // sorted
		expect(points[1].topPx).toBe((9 * 60 + 30) * PX_PER_MIN);
	});

	it('keeps point events out of the block packing entirely', () => {
		const nap = ev('sleep', D(8), D(11));
		const placed = placeBlocks([nap, bottle, diaper], DAY, D(12).getTime());
		// One diaper mid-nap must not squeeze the nap to half width.
		expect(placed).toHaveLength(1);
		expect(placed[0].columns).toBe(1);
	});
});
