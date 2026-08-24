import { describe, it, expect } from 'vitest';
import { formatElapsed, formatClock, nursingDurationMs, todayRangeIso } from './format';

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
