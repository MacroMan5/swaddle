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

/**
 * Effective nursing duration (DEC-001): the sum of segment durations, so paused
 * time is excluded by construction. An open segment counts up to `nowMs`.
 */
export function nursingDurationMs(
	segments: { startedAt: string; endedAt: string | null }[],
	nowMs: number
): number {
	return segments.reduce((sum, s) => {
		const end = s.endedAt === null ? nowMs : Date.parse(s.endedAt);
		return sum + Math.max(0, end - Date.parse(s.startedAt));
	}, 0);
}

/** Local-midnight boundaries of `now`'s day, as UTC ISO strings. */
export function todayRangeIso(now: Date): { from: string; to: string } {
	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
	return { from: start.toISOString(), to: end.toISOString() };
}
