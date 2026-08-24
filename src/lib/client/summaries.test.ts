process.env.TZ = 'America/Toronto';
import { describe, it, expect } from 'vitest';
import {
	splitDurationByLocalDay,
	dailySummary,
	eventOverlapsDay,
	formatNursingSummary,
	formatSleepSummary,
	hasNursingActivity,
	localDayKey,
	dayRangeIso
} from './summaries';
import type { EventDTO } from './types';

const ms = (h: number, m = 0) => (h * 60 + m) * 60_000;
const local = (y: number, mo: number, d: number, h: number, mi = 0) =>
	new Date(y, mo - 1, d, h, mi).getTime();

function sleep(startMs: number, endMs: number | null): EventDTO {
	return {
		id: `s-${startMs}`, babyId: 'baby-1', caregiverId: null, type: 'sleep',
		startedAt: new Date(startMs).toISOString(),
		endedAt: endMs === null ? null : new Date(endMs).toISOString(),
		note: null, details: {}, createdAt: new Date(startMs).toISOString(),
		updatedAt: new Date(startMs).toISOString(), deletedAt: null
	};
}

describe('splitDurationByLocalDay', () => {
	it('keeps a same-day interval on one key', () => {
		const start = local(2026, 8, 24, 14, 0);
		const split = splitDurationByLocalDay(start, start + ms(2));
		expect([...split.entries()]).toEqual([['2026-08-24', ms(2)]]);
	});

	it('AC-006: splits 23:30→01:30 across the two days, total preserved', () => {
		const split = splitDurationByLocalDay(local(2026, 8, 24, 23, 30), local(2026, 8, 25, 1, 30));
		expect(split.get('2026-08-24')).toBe(ms(0, 30));
		expect(split.get('2026-08-25')).toBe(ms(1, 30));
	});

	it('DST fall-back (2026-11-01, America/Toronto): the 25-hour day gets its real duration', () => {
		// 00:30 → 03:30 local crosses the repeated 01:00–02:00 hour: 4 real hours.
		const start = local(2026, 11, 1, 0, 30);
		const end = start + ms(4); // epoch-based: unambiguous
		const split = splitDurationByLocalDay(start, end);
		expect(split.get('2026-11-01')).toBe(ms(4));
		expect([...split.keys()]).toEqual(['2026-11-01']);
	});

	it('DST spring-forward (2026-03-08): 23-hour day, midnight boundary still correct', () => {
		// 2026-03-07 23:00 → 2026-03-08 04:00 local (03:00 wall = 4 real hours after 23:00).
		const start = local(2026, 3, 7, 23, 0);
		const end = local(2026, 3, 8, 4, 0);
		const split = splitDurationByLocalDay(start, end);
		expect(split.get('2026-03-07')).toBe(ms(1));
		expect(split.get('2026-03-08')).toBe(end - start - ms(1));
		expect([...split.values()].reduce((a, b) => a + b)).toBe(end - start);
	});
});

describe('dailySummary', () => {
	it('a midnight-crossing sleep stays one entry but each day gets its share', () => {
		const e = sleep(local(2026, 8, 24, 23, 30), local(2026, 8, 25, 1, 30));
		const d24 = dailySummary([e], '2026-08-24', local(2026, 8, 25, 12, 0));
		const d25 = dailySummary([e], '2026-08-25', local(2026, 8, 25, 12, 0));
		expect(d24.sleep.totalMs).toBe(ms(0, 30));
		expect(d25.sleep.totalMs).toBe(ms(1, 30));
		// Counted once, on its start day.
		expect(d24.sleep.completedCount).toBe(1);
		expect(d25.sleep.completedCount).toBe(0);
	});

	it('open sleep contributes to total up to now but not to average', () => {
		const now = local(2026, 8, 24, 14, 0);
		const open = sleep(now - ms(1), null);
		const done = sleep(local(2026, 8, 24, 9, 0), local(2026, 8, 24, 10, 0));
		const d = dailySummary([open, done], '2026-08-24', now);
		expect(d.sleep.totalMs).toBe(ms(2));
		expect(d.sleep.completedCount).toBe(1);
		expect(d.sleep.averageMs).toBe(ms(1));
	});

	it('nursing splits left/right from segments; bottle/pump/diaper aggregate', () => {
		const start = local(2026, 8, 24, 9, 0);
		const nursing: EventDTO = {
			...sleep(start, start + ms(0, 30)), id: 'n1', type: 'nursing',
			details: { segments: [
				{ side: 'left', startedAt: new Date(start).toISOString(), endedAt: new Date(start + ms(0, 10)).toISOString() },
				{ side: 'right', startedAt: new Date(start + ms(0, 12)).toISOString(), endedAt: new Date(start + ms(0, 30)).toISOString() }
			] }
		};
		const bottle: EventDTO = { ...sleep(start, null), id: 'b1', type: 'bottle', endedAt: null, details: { milkType: 'formula', volumeMl: 90 } };
		const diaper: EventDTO = { ...sleep(start, null), id: 'd1', type: 'diaper', endedAt: null, details: { pee: true, poo: true } };
		const d = dailySummary([nursing, bottle, diaper], '2026-08-24', start + ms(1));
		expect(d.nursing).toEqual({ count: 1, totalMs: ms(0, 28), leftMs: ms(0, 10), rightMs: ms(0, 18) });
		expect(d.bottle).toEqual({ count: 1, totalMl: 90 });
		expect(d.diaper).toEqual({ count: 1, pee: 1, poo: 1 });
	});
});

describe('day helpers', () => {
	it('dayRangeIso spans local midnight to next local midnight', () => {
		const { from, to } = dayRangeIso('2026-11-01'); // 25-hour day
		expect(Date.parse(to) - Date.parse(from)).toBe(ms(25));
		expect(localDayKey(new Date(Date.parse(from)))).toBe('2026-11-01');
	});
});

describe('eventOverlapsDay (review item 2: carry-over visibility)', () => {
	const now = local(2026, 8, 25, 12, 0);

	it('a completed midnight-crossing sleep overlaps both the day it started and the day it ended', () => {
		const e = sleep(local(2026, 8, 24, 23, 30), local(2026, 8, 25, 1, 30));
		expect(eventOverlapsDay(e, '2026-08-24', now)).toBe(true);
		expect(eventOverlapsDay(e, '2026-08-25', now)).toBe(true);
		expect(eventOverlapsDay(e, '2026-08-26', now)).toBe(false);
	});

	it('an open (still-running) timer overlaps every day from its start onward', () => {
		const e = sleep(local(2026, 8, 24, 23, 30), null);
		expect(eventOverlapsDay(e, '2026-08-24', now)).toBe(true);
		expect(eventOverlapsDay(e, '2026-08-25', now)).toBe(true);
	});

	it('a point event (bottle/diaper) only overlaps its start day, even with a null endedAt by design', () => {
		const bottle: EventDTO = {
			...sleep(local(2026, 8, 24, 23, 30), null),
			id: 'b1',
			type: 'bottle',
			details: { milkType: 'formula', volumeMl: 90 }
		};
		expect(eventOverlapsDay(bottle, '2026-08-24', now)).toBe(true);
		expect(eventOverlapsDay(bottle, '2026-08-25', now)).toBe(false);
	});

	it('a same-day event only overlaps its own day', () => {
		const e = sleep(local(2026, 8, 24, 9, 0), local(2026, 8, 24, 10, 0));
		expect(eventOverlapsDay(e, '2026-08-24', now)).toBe(true);
		expect(eventOverlapsDay(e, '2026-08-23', now)).toBe(false);
		expect(eventOverlapsDay(e, '2026-08-25', now)).toBe(false);
	});

	it('a timer ending exactly at the day boundary has zero overlap with the next day (half-open window)', () => {
		const e = sleep(local(2026, 8, 23, 22, 0), local(2026, 8, 24, 0, 0));
		expect(eventOverlapsDay(e, '2026-08-24', now)).toBe(false);
	});
});

describe('hasNursingActivity (review item 5: show the row on a carry-over day with count 0)', () => {
	it('true when count is nonzero', () => {
		expect(hasNursingActivity({ count: 1, totalMs: 0, leftMs: 0, rightMs: 0 })).toBe(true);
	});

	it('true when duration was allocated but the session started the day before (count stays on start day)', () => {
		expect(hasNursingActivity({ count: 0, totalMs: ms(0, 30), leftMs: ms(0, 30), rightMs: 0 })).toBe(true);
	});

	it('false when both are zero', () => {
		expect(hasNursingActivity({ count: 0, totalMs: 0, leftMs: 0, rightMs: 0 })).toBe(false);
	});
});

describe('formatNursingSummary (review item 5: G/D durations in the display)', () => {
	it('includes the left/right breakdown', () => {
		expect(
			formatNursingSummary({ count: 1, totalMs: ms(0, 28), leftMs: ms(0, 10), rightMs: ms(0, 18) })
		).toBe('1 · 28 min · G 10 min / D 18 min');
	});

	it('omits the breakdown when there is no side duration (count-only, e.g. carry-over edge case)', () => {
		expect(formatNursingSummary({ count: 0, totalMs: 0, leftMs: 0, rightMs: 0 })).toBe('0 · 0 min');
	});
});

describe('formatSleepSummary (review item 5: completed-average in the display)', () => {
	it('includes the average and completed count when there is at least one completed period', () => {
		expect(formatSleepSummary({ totalMs: ms(2), completedCount: 2, averageMs: ms(1) })).toBe(
			'2 h 00 · moy. 1 h 00 (2)'
		);
	});

	it('omits the average when nothing has completed yet (only an open timer contributing)', () => {
		expect(formatSleepSummary({ totalMs: ms(0, 30), completedCount: 0, averageMs: 0 })).toBe('30 min');
	});
});
