// DST-safe positioning for DayTimeline's 24 h band (review item 8).
import { localDayKey } from '$lib/client/summaries';

/**
 * Position of `ms` on `dayKey`'s 24 h band, in minutes-since-local-midnight
 * (0–1440), read directly off the wall clock — not elapsed-minutes-since-
 * midnight divided by a fixed 1440. The latter drifts on a DST-transition
 * day: a 23-hour spring-forward day would place 23:30 short of the band's
 * true end, and a 25-hour fall-back day would clamp anything past 24
 * elapsed real hours to 100%, collapsing the last real hour's events onto
 * the band's edge. Reading the clock face directly is immune to both,
 * since `Date`'s local getters already resolve DST for the given instant.
 *
 * Repeated-hour policy (fall-back's doubled 01:00–02:00): both occurrences
 * share the same wall-clock reading and therefore render at the same
 * timeline position — a `Date` alone cannot disambiguate them after the
 * fact, and this is a rare, once-a-year, low-stakes ambiguity for a
 * family-scale app, not worth carrying extra state to resolve.
 *
 * An instant outside `dayKey` (a carry-over start or a still-open/spillover
 * end) clips to the band's edge (0 or 1440) rather than reading a
 * meaningless wall-clock position from a different day.
 */
export function wallClockMinutesOf(ms: number, dayKey: string): number {
	const d = new Date(ms);
	const key = localDayKey(d);
	if (key < dayKey) return 0;
	if (key > dayKey) return 1440;
	return d.getHours() * 60 + d.getMinutes();
}
