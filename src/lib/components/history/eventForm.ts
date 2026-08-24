// Shared helpers for EventEditSheet and ManualAddSheet: `datetime-local` input
// conversion, so both forms treat the field the same way (local wall time, no
// timezone maths leaking into either component).

/** `Date` → the value a `datetime-local` input expects, in local time. */
export function toLocalInputValue(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` input's value → ISO UTC, for the API. */
export function fromLocalInputValue(value: string): string {
	return new Date(value).toISOString();
}

/**
 * ManualAddSheet's default `startedAt` (review item 6, FR-017). A fixed noon
 * of the day being viewed is safe for any past day, but is a *future*
 * timestamp — rejected by the server's 5-minute tolerance — whenever today's
 * corrected clock (`store.nowMs`) hasn't reached noon yet. For today, default
 * to the corrected now instead; only a past day gets the fixed noon.
 */
export function manualAddDefaultTime(dayKey: string, todayKey: string, nowMs: number): Date {
	if (dayKey === todayKey) return new Date(nowMs);
	const [y, m, d] = dayKey.split('-').map(Number);
	return new Date(y, m - 1, d, 12, 0);
}
