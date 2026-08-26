import { describe, it, expect } from 'vitest';
import { spokenDuration } from './speech';

describe('spokenDuration', () => {
	it.each([
		[0, "moins d'une minute"],
		[29_000, "moins d'une minute"],
		[60_000, '1 minute'],
		[40 * 60_000, '40 minutes'],
		[59 * 60_000 + 40_000, '1 heure'],
		[60 * 60_000, '1 heure'],
		[65 * 60_000, '1 heure 5 minutes'],
		[121 * 60_000, '2 heures 1 minute'],
		[180 * 60_000, '3 heures']
	])('says %i ms as "%s"', (ms, expected) => {
		expect(spokenDuration(ms)).toBe(expected);
	});

	it('never announces a negative duration', () => {
		expect(spokenDuration(-5_000)).toBe("moins d'une minute");
	});
});
