/**
 * The French sentences a voice assistant reads back (ADR 0004). They are the
 * only user-facing text this module produces, and the reason they live apart
 * from `performQuick`: a spoken phrase is pure formatting, exhaustively
 * testable without a database or a clock.
 */

/**
 * A duration said out loud, rounded to the minute — nobody wants Siri reading
 * seconds. Negative input (a clock skew between start and stop) is floored to
 * zero rather than announced.
 */
export function spokenDuration(ms: number): string {
	const minutes = Math.round(Math.max(ms, 0) / 60_000);
	if (minutes < 1) return "moins d'une minute";
	if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	const spokenHours = `${hours} heure${hours > 1 ? 's' : ''}`;
	if (rest === 0) return spokenHours;
	return `${spokenHours} ${rest} minute${rest > 1 ? 's' : ''}`;
}

export const SPOKEN_SIDE = { left: 'gauche', right: 'droit' } as const;

export const SPOKEN_DIAPER = {
	wet: 'pipi',
	dirty: 'caca',
	both: 'pipi et caca'
} as const;
