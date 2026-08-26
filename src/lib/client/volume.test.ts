import { describe, expect, it } from 'vitest';
import {
	MAX_VOLUME_ML,
	MAX_VOLUME_OZ,
	MIN_VOLUME_ML,
	MIN_VOLUME_OZ,
	displayVolumeValue,
	editedVolumeEntry,
	formatVolume,
	mlToOz,
	ozToMl,
	parseVolumeEntry,
	parseVolumeValue,
	roundToUnitPrecision,
	volumeBounds,
	volumePresets,
	volumeRangeLabel,
	volumeStep
} from './volume';

/** The canonical millilitres of an entry expected to be valid. */
function okMl(raw: string, unit: 'ml' | 'oz'): number {
	const entry = parseVolumeEntry(raw, unit);
	if (entry.status !== 'ok') throw new Error(`expected "${raw}" (${unit}) to parse, got ${entry.status}`);
	return entry.volumeMl;
}

describe('conversion', () => {
	it('rounds ounces to the nearest whole millilitre', () => {
		expect(ozToMl(1)).toBe(30);
		expect(ozToMl(3)).toBe(89);
		expect(ozToMl(0.5)).toBe(15);
		expect(ozToMl(33.8)).toBe(1000);
	});

	it('converts millilitres to ounces without rounding', () => {
		expect(mlToOz(29.5735295625)).toBe(1);
		expect(mlToOz(90)).toBeCloseTo(3.0433, 3);
	});

	it('keeps the ounce bounds inside the canonical millilitre range', () => {
		expect(ozToMl(MIN_VOLUME_OZ)).toBeGreaterThanOrEqual(MIN_VOLUME_ML);
		expect(ozToMl(MAX_VOLUME_OZ)).toBeLessThanOrEqual(MAX_VOLUME_ML);
		expect(volumeBounds('oz')).toEqual({ min: 0.1, max: 33.8 });
		expect(volumeBounds('ml')).toEqual({ min: 1, max: 1000 });
	});
});

describe('display', () => {
	it('shows millilitres as stored and ounces to one decimal, French', () => {
		expect(displayVolumeValue(90, 'ml')).toBe('90');
		expect(displayVolumeValue(90, 'oz')).toBe('3,0');
		expect(formatVolume(90, 'ml')).toBe('90 ml');
		expect(formatVolume(90, 'oz')).toBe('3,0 oz');
		expect(formatVolume(0, 'oz')).toBe('0,0 oz');
	});

	it('stays within a display tick of the stored value, and never compounds', () => {
		// Every canonical millilitre survives a display round-trip within half an
		// ounce tick (≈1,5 ml), and a *second* round-trip lands on the same place:
		// the conversion is derived, never accumulated.
		for (let ml = MIN_VOLUME_ML + 2; ml <= MAX_VOLUME_ML; ml += 7) {
			const once = okMl(displayVolumeValue(ml, 'oz'), 'oz');
			expect(Math.abs(once - ml)).toBeLessThanOrEqual(2);
			expect(okMl(displayVolumeValue(once, 'oz'), 'oz')).toBe(once);
		}
	});

	it('labels the range per unit', () => {
		expect(volumeRangeLabel('ml')).toBe('entre 1 et 1000 ml');
		expect(volumeRangeLabel('oz')).toBe('entre 0,1 et 33,8 oz');
	});

	it('offers a step and presets per unit', () => {
		expect(volumeStep('ml')).toBe(10);
		expect(volumeStep('oz')).toBe(0.5);
		expect(volumePresets('ml')).toEqual([60, 90, 120, 150]);
		expect(volumePresets('oz')).toEqual([2, 3, 4, 5]);
	});
});

describe('parseVolumeEntry', () => {
	it('accepts the French decimal comma the app itself renders', () => {
		expect(parseVolumeValue('3,5')).toBe(3.5);
		expect(parseVolumeValue('3.5')).toBe(3.5);
		expect(parseVolumeValue(' 120 ')).toBe(120);
	});

	it('reports a blank field as empty, not as zero (issue #36)', () => {
		expect(parseVolumeEntry('', 'oz')).toEqual({ status: 'empty' });
		expect(parseVolumeEntry('   ', 'ml')).toEqual({ status: 'empty' });
	});

	it('reports an unparseable field as invalid, leaving the copy to the server', () => {
		expect(parseVolumeEntry('abc', 'oz')).toEqual({ status: 'invalid' });
	});

	it('converts an entered value to canonical millilitres once', () => {
		expect(okMl('120', 'ml')).toBe(120);
		expect(okMl('4,5', 'oz')).toBe(133);
		expect(okMl('0,1', 'oz')).toBe(3);
	});

	it('rounds to the precision the field advertises before judging it', () => {
		expect(roundToUnitPrecision(4.25, 'oz')).toBe(4.3);
		expect(roundToUnitPrecision(90.4, 'ml')).toBe(90);
		// A multi-decimal value inside the range is accepted at one decimal —
		// the field never promised to keep more than that.
		expect(okMl('4,25', 'oz')).toBe(ozToMl(4.3));
		expect(okMl('4,25', 'oz')).toBe(127);
	});

	// The bug this guards: 0,04 oz converts to a perfectly legal 1 ml, so the
	// server would take it — and the row would then read "0,0 oz".
	it('rejects an ounce entry that would display outside the advertised range', () => {
		const tooSmall = parseVolumeEntry('0,04', 'oz');
		expect(tooSmall.status).toBe('out-of-range');
		expect(tooSmall).toMatchObject({ message: 'Le volume doit être d’au moins 0,1 oz.' });
		// Nothing accepted can render as "0,0 oz".
		expect(displayVolumeValue(okMl('0,1', 'oz'), 'oz')).not.toBe('0,0');
	});

	it('holds the ounce boundaries, and refuses just outside them', () => {
		expect(okMl('0,1', 'oz')).toBe(3);
		expect(okMl('33,8', 'oz')).toBe(1000);
		// One tick outside, at the precision the field advertises.
		expect(parseVolumeEntry('0,0', 'oz').status).toBe('out-of-range');
		expect(parseVolumeEntry('33,9', 'oz').status).toBe('out-of-range');
		// …while a finer value that still rounds *onto* a boundary is kept: the
		// precision rule judges what the field will show, so 0,09 is 0,1 oz.
		expect(okMl('0,09', 'oz')).toBe(3);
		expect(okMl('0,05', 'oz')).toBe(3);
		expect(okMl('33,84', 'oz')).toBe(1000);
		// …and one that rounds past a boundary is not.
		expect(parseVolumeEntry('33,85', 'oz').status).toBe('out-of-range');
	});

	it('holds the millilitre boundaries the server enforces', () => {
		expect(okMl('1', 'ml')).toBe(1);
		expect(okMl('1000', 'ml')).toBe(1000);
		expect(parseVolumeEntry('0', 'ml')).toMatchObject({
			status: 'out-of-range',
			message: 'Le volume doit être d’au moins 1 ml.'
		});
		expect(parseVolumeEntry('1500', 'ml')).toMatchObject({
			status: 'out-of-range',
			message: 'Le volume ne peut pas dépasser 1000 ml.'
		});
	});

	it('rejects a negative entry in either unit', () => {
		expect(parseVolumeEntry('-5', 'oz').status).toBe('out-of-range');
		expect(parseVolumeEntry('-5', 'ml').status).toBe('out-of-range');
	});
});

describe('editedVolumeEntry', () => {
	it('keeps the stored millilitres when the field was not touched', () => {
		const pristine = { raw: '3,0', ml: 90 };
		expect(editedVolumeEntry('3,0', pristine, 'oz')).toEqual({ status: 'ok', volumeMl: 90 });
		// Re-opening and re-saving any number of times never moves it.
		expect(editedVolumeEntry('3,0', { raw: '3,0', ml: 90 }, 'oz')).toEqual({
			status: 'ok',
			volumeMl: 90
		});
	});

	it('converts once when the field really changed', () => {
		expect(editedVolumeEntry('4,0', { raw: '3,0', ml: 90 }, 'oz')).toEqual({
			status: 'ok',
			volumeMl: 118
		});
		expect(editedVolumeEntry('100', { raw: '90', ml: 90 }, 'ml')).toEqual({
			status: 'ok',
			volumeMl: 100
		});
	});

	it('carries a cleared field through as empty (an open pump session)', () => {
		expect(editedVolumeEntry('', { raw: '3,0', ml: 90 }, 'oz')).toEqual({ status: 'empty' });
		expect(editedVolumeEntry('', { raw: '', ml: null }, 'oz')).toEqual({ status: 'empty' });
	});

	it('validates a real edit against the advertised bounds', () => {
		expect(editedVolumeEntry('0,04', { raw: '3,0', ml: 90 }, 'oz').status).toBe('out-of-range');
	});
});
