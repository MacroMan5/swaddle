// Single place where the household's volume unit (issue #44) turns canonical
// millilitres into something to read, and a typed value back into canonical
// millilitres. Storage, the API contract and the exports stay in integer
// `volumeMl` (FR-017, [1, 1000]); everything here is presentation.
//
// Two rules keep the round-trip honest:
//  - a displayed ounce value is always derived fresh from the stored ml, never
//    from a previously converted number, so nothing accumulates drift;
//  - an edit that leaves the field untouched keeps the stored ml verbatim
//    (`editedVolumeMl`), so opening and saving a form in oz never re-rounds it.

export type VolumeUnit = 'ml' | 'oz';

/** 1 US fluid ounce, exactly. */
export const ML_PER_OZ = 29.5735295625;

/** Canonical bounds (FR-017), the server stays the backstop of record. */
export const MIN_VOLUME_ML = 1;
export const MAX_VOLUME_ML = 1000;

export function mlToOz(ml: number): number {
	return ml / ML_PER_OZ;
}

/** Ounces → the nearest whole millilitre, the only unit we store. */
export function ozToMl(oz: number): number {
	return Math.round(oz * ML_PER_OZ);
}

const OZ_FORMAT = new Intl.NumberFormat('fr-CA', {
	minimumFractionDigits: 1,
	maximumFractionDigits: 1
});

/**
 * Ounce bounds narrowed to what one decimal can express *inside* the canonical
 * range: 1 ml is 0,03 oz, which would render as "0,0 oz" and read as a
 * forbidden value. Rounding the minimum up and the maximum down keeps every
 * displayable ounce value a legal millilitre value too.
 */
export const MIN_VOLUME_OZ = Math.ceil(mlToOz(MIN_VOLUME_ML) * 10) / 10;
export const MAX_VOLUME_OZ = Math.floor(mlToOz(MAX_VOLUME_ML) * 10) / 10;

/** Display bounds in the given unit, as numbers in that unit. */
export function volumeBounds(unit: VolumeUnit): { min: number; max: number } {
	return unit === 'oz'
		? { min: MIN_VOLUME_OZ, max: MAX_VOLUME_OZ }
		: { min: MIN_VOLUME_ML, max: MAX_VOLUME_ML };
}

/** One-handed nudge of the entry field: 10 ml, or half an ounce. */
export function volumeStep(unit: VolumeUnit): number {
	return unit === 'oz' ? 0.5 : 10;
}

/** Quick presets under the entry field: ~2 to 5 oz either way. */
export function volumePresets(unit: VolumeUnit): number[] {
	return unit === 'oz' ? [2, 3, 4, 5] : [60, 90, 120, 150];
}

/** A number in `unit`, French-formatted: "90", "3,5". */
export function formatVolumeValue(value: number, unit: VolumeUnit): string {
	return unit === 'oz' ? OZ_FORMAT.format(value) : String(value);
}

/** Stored millilitres → the value to show in `unit`, without the unit. */
export function displayVolumeValue(ml: number, unit: VolumeUnit): string {
	return unit === 'oz' ? OZ_FORMAT.format(mlToOz(ml)) : String(ml);
}

/** Stored millilitres → the full label: "90 ml", "3,0 oz". */
export function formatVolume(ml: number, unit: VolumeUnit): string {
	return `${displayVolumeValue(ml, unit)} ${unit}`;
}

/** A bound as a label: "1 ml", "33,8 oz". */
export function boundLabel(value: number, unit: VolumeUnit): string {
	return `${formatVolumeValue(value, unit)} ${unit}`;
}

/** "entre 1 et 1000 ml" / "entre 0,1 et 33,8 oz" — one range, one unit suffix. */
export function volumeRangeLabel(unit: VolumeUnit): string {
	const { min, max } = volumeBounds(unit);
	return `entre ${formatVolumeValue(min, unit)} et ${formatVolumeValue(max, unit)} ${unit}`;
}

/**
 * A typed field value → the number it means in `unit`, or null when it isn't
 * one. Accepts the French decimal comma the app itself renders, so a value
 * read back out of a prefilled field parses the way it was written.
 */
export function parseVolumeValue(raw: string): number | null {
	const trimmed = raw.trim().replace(',', '.');
	if (trimmed === '') return null;
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}

/**
 * A typed field value → canonical millilitres, or null when it isn't a number.
 *
 * Null on an empty field is load-bearing (issue #36): `pump.volumeMl` is
 * nullable server-side because the volume isn't known until the session ends,
 * so an empty field must send `null`, not `Number('') === 0` — a phantom zero
 * that trips the generic `min(1)` rule instead of letting the server's own
 * "volume required to close a pump session" rule apply.
 */
export function parseVolumeMl(raw: string, unit: VolumeUnit): number | null {
	const value = parseVolumeValue(raw);
	if (value === null) return null;
	return unit === 'oz' ? ozToMl(value) : value;
}

/** True when `ml` is inside the canonical range the server enforces. */
export function isVolumeMlInRange(ml: number): boolean {
	return ml >= MIN_VOLUME_ML && ml <= MAX_VOLUME_ML;
}

/**
 * The canonical millilitres an edited field means. When the field still reads
 * exactly as it was rendered from `originalMl`, the stored value is returned
 * untouched: converting "3,0 oz" back would land on 89 ml, silently rewriting
 * a 90 ml bottle nobody edited.
 */
export function editedVolumeMl(
	raw: string,
	pristine: { raw: string; ml: number | null },
	unit: VolumeUnit
): number | null {
	if (raw === pristine.raw) return pristine.ml;
	return parseVolumeMl(raw, unit);
}
