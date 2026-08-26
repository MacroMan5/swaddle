import { describe, it, expect } from 'vitest';
import {
	manualAddDefaultTime,
	toLocalInputValue,
	fromLocalInputValue
} from './eventForm';

describe('manualAddDefaultTime (review item 6: FR-017 — never default into the future)', () => {
	it('uses the corrected now for today, not a fixed noon (which would be in the future before ~11:55)', () => {
		const nowMs = new Date(2026, 7, 24, 8, 30).getTime(); // 08:30, well before noon
		const result = manualAddDefaultTime('2026-08-24', '2026-08-24', nowMs);
		expect(result.getTime()).toBe(nowMs);
	});

	it('also uses now for today when now is after noon', () => {
		const nowMs = new Date(2026, 7, 24, 15, 0).getTime();
		const result = manualAddDefaultTime('2026-08-24', '2026-08-24', nowMs);
		expect(result.getTime()).toBe(nowMs);
	});

	it('uses a safe fixed noon for a past day, independent of the current time', () => {
		const nowMs = new Date(2026, 7, 25, 8, 30).getTime();
		const result = manualAddDefaultTime('2026-08-24', '2026-08-25', nowMs);
		expect(result).toEqual(new Date(2026, 7, 24, 12, 0));
	});
});

describe('eventForm datetime-local round trip', () => {
	it('toLocalInputValue then fromLocalInputValue preserves the instant', () => {
		const original = new Date(2026, 7, 24, 9, 5);
		const roundTripped = fromLocalInputValue(toLocalInputValue(original));
		expect(Date.parse(roundTripped)).toBe(original.getTime());
	});
});
