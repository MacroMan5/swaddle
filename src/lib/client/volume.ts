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
 * The entered value rounded to the precision the field advertises: one decimal
 * in ounces (what `formatVolume` shows), whole millilitres otherwise (what the
 * canonical store holds). Rounding *before* judging the value is what makes the
 * bounds honest — see `parseVolumeEntry`.
 */
export function roundToUnitPrecision(value: number, unit: VolumeUnit): number {
	return unit === 'oz' ? Math.round(value * 10) / 10 : Math.round(value);
}

/** "Le volume doit être d’au moins 1 ml." / "… 0,1 oz." */
export function volumeTooSmallMessage(unit: VolumeUnit): string {
	return `Le volume doit être d’au moins ${boundLabel(volumeBounds(unit).min, unit)}.`;
}

/** "Le volume ne peut pas dépasser 1000 ml." / "… 33,8 oz." */
export function volumeTooBigMessage(unit: VolumeUnit): string {
	return `Le volume ne peut pas dépasser ${boundLabel(volumeBounds(unit).max, unit)}.`;
}

/**
 * What a volume field's raw text means.
 *
 * `empty` is load-bearing (issue #36): `pump.volumeMl` is nullable server-side
 * because the volume isn't known until the session ends, so a blank field must
 * send `null`, not `Number('') === 0` — a phantom zero that trips the generic
 * `min(1)` rule instead of letting the server's own "volume required to close a
 * pump session" rule apply. `invalid` is left to the server, whose "must be a
 * number" message already covers it.
 */
export type VolumeEntry =
	| { status: 'empty' }
	| { status: 'invalid' }
	| { status: 'out-of-range'; message: string }
	| { status: 'ok'; volumeMl: number };

/**
 * A typed field value → canonical millilitres, judged in the unit it was typed
 * in.
 *
 * **Precision rule**: the entry is first rounded to the precision the field
 * advertises (`roundToUnitPrecision`), then checked against that unit's bounds,
 * and only then converted. Rounding first is deliberate — an ounce field shows
 * one decimal, so "4,25" is an in-range 4,3 oz and is accepted rather than
 * rejected for a precision the field never promised to keep.
 *
 * Checking the *entered* value rather than the converted millilitres is what
 * closes the gap the ounce bounds exist for: 0,04 oz converts to a perfectly
 * legal 1 ml, so the server would accept it — and the row would then read
 * "0,0 oz", a value the form declares out of range. Anything that would display
 * outside 0,1–33,8 oz is refused here, before the conversion can smuggle it in.
 */
export function parseVolumeEntry(raw: string, unit: VolumeUnit): VolumeEntry {
	if (raw.trim() === '') return { status: 'empty' };
	const value = parseVolumeValue(raw);
	if (value === null) return { status: 'invalid' };

	const rounded = roundToUnitPrecision(value, unit);
	const { min, max } = volumeBounds(unit);
	if (rounded < min) return { status: 'out-of-range', message: volumeTooSmallMessage(unit) };
	if (rounded > max) return { status: 'out-of-range', message: volumeTooBigMessage(unit) };

	return { status: 'ok', volumeMl: unit === 'oz' ? ozToMl(rounded) : rounded };
}

/**
 * What an *edited* volume field means. When the field still reads exactly as it
 * was rendered from `pristine.ml`, that stored value is returned untouched:
 * re-reading "3,0 oz" would land on 89 ml, silently rewriting a 90 ml bottle
 * nobody edited.
 */
export function editedVolumeEntry(
	raw: string,
	pristine: { raw: string; ml: number | null },
	unit: VolumeUnit
): VolumeEntry {
	if (raw === pristine.raw) {
		return pristine.ml === null ? { status: 'empty' } : { status: 'ok', volumeMl: pristine.ml };
	}
	return parseVolumeEntry(raw, unit);
}
