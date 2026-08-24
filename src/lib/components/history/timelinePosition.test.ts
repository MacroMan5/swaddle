process.env.TZ = 'America/Toronto';
import { describe, it, expect } from 'vitest';
import { wallClockMinutesOf } from './timelinePosition';

const local = (y: number, mo: number, d: number, h: number, mi = 0) =>
	new Date(y, mo - 1, d, h, mi).getTime();

describe('wallClockMinutesOf (review item 8: DST-safe timeline positioning)', () => {
	it('reads plain wall-clock minutes on an ordinary day', () => {
		expect(wallClockMinutesOf(local(2026, 8, 24, 9, 30), '2026-08-24')).toBe(9 * 60 + 30);
		expect(wallClockMinutesOf(local(2026, 8, 24, 0, 0), '2026-08-24')).toBe(0);
	});

	it('spring-forward (2026-03-08, 23-hour day): 23:30 wall clock still reads as 23:30, not shifted early', () => {
		// Elapsed-minutes-since-midnight positioning would read this as
		// (23h real elapsed instead of the wall clock's 23:30), landing short of
		// the band's end; wall-clock reading must place it at the true 23:30 mark.
		const ms = local(2026, 3, 8, 23, 30);
		expect(wallClockMinutesOf(ms, '2026-03-08')).toBe(23 * 60 + 30);
	});

	it('fall-back (2026-11-01, 25-hour day): 23:30 wall clock reads as 23:30, not clipped past 100%', () => {
		// Elapsed-minutes-since-midnight positioning would compute 24h50m elapsed
		// (> 1440), clamping to 100%; wall-clock reading reads the clock face
		// directly and is immune to the extra real hour entirely.
		const ms = local(2026, 11, 1, 23, 30);
		expect(wallClockMinutesOf(ms, '2026-11-01')).toBe(23 * 60 + 30);
	});

	it('documented repeated-hour policy: both occurrences of the doubled 01:30 on fall-back read as the same wall-clock position', () => {
		// 2026-11-01 01:30 EDT and 2026-11-01 01:30 EST are 1 real hour apart but
		// share the same wall-clock reading. A Date's local getHours()/getMinutes()
		// cannot distinguish them after the fact, so both are intentionally placed
		// at the same timeline position — a rare, once-a-year, low-stakes ambiguity
		// for a family-scale app, not worth carrying extra disambiguation state for.
		const edt = Date.UTC(2026, 10, 1, 5, 30); // 01:30 EDT (UTC-4)
		const est = Date.UTC(2026, 10, 1, 6, 30); // 01:30 EST (UTC-5)
		expect(wallClockMinutesOf(edt, '2026-11-01')).toBe(wallClockMinutesOf(est, '2026-11-01'));
	});

	it('clips to the start of the band when the instant falls on an earlier local day (carry-over)', () => {
		const ms = local(2026, 8, 23, 23, 30);
		expect(wallClockMinutesOf(ms, '2026-08-24')).toBe(0);
	});

	it('clips to the end of the band when the instant falls on a later local day (still-open/spillover)', () => {
		const ms = local(2026, 8, 25, 1, 30);
		expect(wallClockMinutesOf(ms, '2026-08-24')).toBe(1440);
	});
});
