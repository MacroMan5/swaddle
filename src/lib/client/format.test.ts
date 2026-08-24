import { describe, it, expect } from 'vitest';
import {
	formatElapsed,
	formatClock,
	formatTimeOfDay,
	formatTimeRange,
	nursingDurationMs,
	todayRangeIso,
	isNewLocalDay
} from './format';

describe('formatElapsed', () => {
	it('clamps negative to zero (server clock ahead)', () => {
		expect(formatElapsed(-5000)).toBe('0 min');
	});
	it('formats minutes and hours in French', () => {
		expect(formatElapsed(12 * 60_000)).toBe('12 min');
		expect(formatElapsed(65 * 60_000)).toBe('1 h 05');
	});
});

describe('formatClock', () => {
	it('formats MM:SS then H:MM:SS', () => {
		expect(formatClock(0)).toBe('00:00');
		expect(formatClock(83_000)).toBe('01:23');
		expect(formatClock(3_723_000)).toBe('1:02:03');
	});
	it('clamps negative to 00:00', () => {
		expect(formatClock(-1)).toBe('00:00');
	});
});

describe('nursingDurationMs (DEC-001: pause excluded)', () => {
	it('sums closed segments and counts the open one up to now', () => {
		const t0 = Date.parse('2026-08-24T10:00:00.000Z');
		const segments = [
			{ startedAt: '2026-08-24T10:00:00.000Z', endedAt: '2026-08-24T10:10:00.000Z' },
			{ startedAt: '2026-08-24T10:15:00.000Z', endedAt: null }
		];
		// 10 min closed + 5 min open (10:15 → 10:20); the 5 min pause is excluded.
		expect(nursingDurationMs(segments, t0 + 20 * 60_000)).toBe(15 * 60_000);
	});
});

describe('todayRangeIso', () => {
	it('spans local midnight to next local midnight', () => {
		const { from, to } = todayRangeIso(new Date(2026, 7, 24, 14, 30));
		expect(Date.parse(to) - Date.parse(from)).toBe(24 * 3_600_000);
		expect(new Date(from).getHours()).toBe(0);
	});
});

describe('isNewLocalDay (server-corrected clock, item 3)', () => {
	it('detects a rollover using the corrected clock, even across a small skew', () => {
		const beforeMidnight = new Date(2026, 7, 24, 23, 59, 58).getTime();
		// Server 5s ahead of the device clock: the corrected time already crossed midnight.
		const correctedAfterMidnight = beforeMidnight + 5000;
		expect(isNewLocalDay(beforeMidnight, correctedAfterMidnight)).toBe(true);
	});

	it('is false within the same day', () => {
		const t0 = new Date(2026, 7, 24, 10, 0, 0).getTime();
		expect(isNewLocalDay(t0, t0 + 60_000)).toBe(false);
	});
});

describe('formatTimeOfDay', () => {
	it('pads both fields to two digits', () => {
		expect(formatTimeOfDay(new Date(2026, 7, 24, 7, 5).getTime())).toBe('07:05');
		expect(formatTimeOfDay(new Date(2026, 7, 24, 23, 59).getTime())).toBe('23:59');
		expect(formatTimeOfDay(new Date(2026, 7, 24, 0, 0).getTime())).toBe('00:00');
	});
});

describe('formatTimeRange', () => {
	const start = new Date(2026, 7, 24, 7, 15).getTime();

	it('renders a closed span with an en dash', () => {
		const end = new Date(2026, 7, 24, 7, 40).getTime();
		expect(formatTimeRange(start, end)).toBe('07:15 – 07:40');
	});

	it('marks a still-running timer instead of inventing an end', () => {
		expect(formatTimeRange(start, null)).toBe('07:15 – en cours');
	});

	it('keeps a span that crosses midnight readable on its own terms', () => {
		const end = new Date(2026, 7, 25, 1, 30).getTime();
		// The date is carried by the row/block, not by this string.
		expect(formatTimeRange(new Date(2026, 7, 24, 23, 30).getTime(), end)).toBe('23:30 – 01:30');
	});
});
