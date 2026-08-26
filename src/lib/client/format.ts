/** Calm, minute-level elapsed time for cards: "0 min", "12 min", "1 h 05". */
export function formatElapsed(ms: number): string {
	const minutes = Math.max(0, Math.floor(ms / 60_000));
	if (minutes < 60) return `${minutes} min`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return `${h} h ${String(m).padStart(2, '0')}`;
}

/** Running-timer clock: "MM:SS" under an hour, "H:MM:SS" beyond. */
export function formatClock(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const s = total % 60;
	const m = Math.floor(total / 60) % 60;
	const h = Math.floor(total / 3600);
	const mm = String(m).padStart(2, '0');
	const ss = String(s).padStart(2, '0');
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// DEC-001's effective nursing duration is a rule of the event contract, not a
// client formatting concern: the server says it out loud too (`/api/quick`).
// It lives in `$lib/shared/events` and is re-exported here so the client's
// long-standing import path keeps working.
export { nursingDurationMs } from '$lib/shared/events';

/** Local-midnight boundaries of `now`'s day, as UTC ISO strings. */
export function todayRangeIso(now: Date): { from: string; to: string } {
	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
	return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * True when `nextMs`'s local calendar day differs from `prevMs`'s. Callers pass
 * the server-corrected clock (RISK-001), not the raw device clock, so a skewed
 * device time never masks — or falsely triggers — a midnight rollover.
 */
export function isNewLocalDay(prevMs: number, nextMs: number): boolean {
	const a = new Date(prevMs);
	const b = new Date(nextMs);
	return (
		a.getFullYear() !== b.getFullYear() ||
		a.getMonth() !== b.getMonth() ||
		a.getDate() !== b.getDate()
	);
}

/** Wall-clock time of day, in local time: "07:15". */
export function formatTimeOfDay(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Display span of a durational event: "07:15 – 07:40", or "07:15 – en cours"
 * while its timer is still running (`endMs === null`).
 *
 * Point events (bottle, diaper) have no span by construction — call
 * `formatTimeOfDay` for those rather than passing a null end here, so a
 * running timer and a point event never render the same way.
 */
export function formatTimeRange(startMs: number, endMs: number | null): string {
	const start = formatTimeOfDay(startMs);
	return endMs === null ? `${start} – en cours` : `${start} – ${formatTimeOfDay(endMs)}`;
}
