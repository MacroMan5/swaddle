import { describe, expect, it } from 'vitest';
import { formatBabyAge } from './babyAge';

// Fixed local clock: 2026-08-24 (a Monday), mid-afternoon.
const NOW = new Date(2026, 7, 24, 15, 30).getTime();

describe('formatBabyAge', () => {
	it('counts days under two weeks', () => {
		expect(formatBabyAge('2026-08-24', NOW)).toBe('0 j');
		expect(formatBabyAge('2026-08-20', NOW)).toBe('4 j');
		expect(formatBabyAge('2026-08-11', NOW)).toBe('13 j');
	});

	it('clamps a future birthdate to zero', () => {
		expect(formatBabyAge('2026-09-01', NOW)).toBe('0 j');
	});

	it('counts weeks from two weeks to three months', () => {
		expect(formatBabyAge('2026-08-10', NOW)).toBe('2 sem');
		expect(formatBabyAge('2026-06-15', NOW)).toBe('10 sem');
	});

	it('counts months from three to twenty-four', () => {
		expect(formatBabyAge('2026-05-24', NOW)).toBe('3 mois');
		expect(formatBabyAge('2026-05-25', NOW)).toBe('13 sem');
		expect(formatBabyAge('2025-01-10', NOW)).toBe('19 mois');
	});

	it('switches to years at twenty-four months', () => {
		expect(formatBabyAge('2024-08-24', NOW)).toBe('2 ans');
		expect(formatBabyAge('2024-05-24', NOW)).toBe('2 ans 3 mois');
	});

	it('accepts a full ISO timestamp birthdate', () => {
		expect(formatBabyAge('2026-08-20T08:15:00.000Z', NOW)).toBe('4 j');
	});
});
