import { describe, expect, it } from 'vitest';
import {
	MAX_VOLUME_ML,
	MAX_VOLUME_OZ,
	MIN_VOLUME_ML,
	MIN_VOLUME_OZ,
	displayVolumeValue,
	editedVolumeMl,
	formatVolume,
	isVolumeMlInRange,
	mlToOz,
	ozToMl,
	parseVolumeMl,
	parseVolumeValue,
	volumeBounds,
	volumePresets,
	volumeRangeLabel,
	volumeStep
} from './volume';

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
		for (let ml = MIN_VOLUME_ML; ml <= MAX_VOLUME_ML; ml += 7) {
			const once = parseVolumeMl(displayVolumeValue(ml, 'oz'), 'oz');
			expect(once).not.toBeNull();
			expect(Math.abs((once as number) - ml)).toBeLessThanOrEqual(2);
			expect(parseVolumeMl(displayVolumeValue(once as number, 'oz'), 'oz')).toBe(once);
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

describe('parsing', () => {
	it('accepts the French decimal comma the app itself renders', () => {
		expect(parseVolumeValue('3,5')).toBe(3.5);
		expect(parseVolumeValue('3.5')).toBe(3.5);
		expect(parseVolumeValue(' 120 ')).toBe(120);
	});

	it('rejects blanks and non-numbers', () => {
		expect(parseVolumeValue('')).toBeNull();
		expect(parseVolumeValue('   ')).toBeNull();
		expect(parseVolumeValue('abc')).toBeNull();
		expect(parseVolumeMl('abc', 'oz')).toBeNull();
	});

	it('converts an entered value to canonical millilitres once', () => {
		expect(parseVolumeMl('120', 'ml')).toBe(120);
		expect(parseVolumeMl('4,5', 'oz')).toBe(133);
		expect(parseVolumeMl('0,1', 'oz')).toBe(3);
	});

	it('knows the canonical range', () => {
		expect(isVolumeMlInRange(1)).toBe(true);
		expect(isVolumeMlInRange(1000)).toBe(true);
		expect(isVolumeMlInRange(0)).toBe(false);
		expect(isVolumeMlInRange(1001)).toBe(false);
	});
});

describe('editedVolumeMl', () => {
	it('keeps the stored millilitres when the field was not touched', () => {
		const pristine = { raw: '3,0', ml: 90 };
		expect(editedVolumeMl('3,0', pristine, 'oz')).toBe(90);
		// Re-opening and re-saving any number of times never moves it.
		expect(editedVolumeMl('3,0', { raw: '3,0', ml: 90 }, 'oz')).toBe(90);
	});

	it('converts once when the field really changed', () => {
		expect(editedVolumeMl('4,0', { raw: '3,0', ml: 90 }, 'oz')).toBe(118);
		expect(editedVolumeMl('100', { raw: '90', ml: 90 }, 'ml')).toBe(100);
	});

	it('carries a cleared field through as null (an open pump session)', () => {
		expect(editedVolumeMl('', { raw: '3,0', ml: 90 }, 'oz')).toBeNull();
		expect(editedVolumeMl('', { raw: '', ml: null }, 'oz')).toBeNull();
	});
});
