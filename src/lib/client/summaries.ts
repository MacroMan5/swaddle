// Pure day-splitting summaries engine (FR-010, AC-006). Feeds both the Today
// SummaryCard and the History day/week views — one source of truth so counts
// and durations never disagree between screens.
import { formatElapsed } from './format';
import { isTimerType, isType } from './types';
import type { EventDTO } from './types';

/** `YYYY-MM-DD` for `d`'s local calendar day. */
export function localDayKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/**
 * Splits `[startMs, endMs)` across local calendar days, attributing each slice
 * the real elapsed time it spans (DST-safe: midnight boundaries come from
 * `new Date(y, m, d + 1)`, never a fixed 24 h step). Total always equals
 * `endMs - startMs`.
 */
export function splitDurationByLocalDay(startMs: number, endMs: number): Map<string, number> {
	const result = new Map<string, number>();
	let cursor = startMs;
	while (cursor < endMs) {
		const d = new Date(cursor);
		const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
		const sliceEnd = Math.min(endMs, nextMidnight);
		const key = localDayKey(d);
		result.set(key, (result.get(key) ?? 0) + (sliceEnd - cursor));
		cursor = sliceEnd;
	}
	return result;
}

/** Local midnight → next local midnight for `dayKey`, as UTC ISO strings. */
export function dayRangeIso(dayKey: string): { from: string; to: string } {
	const [y, m, d] = dayKey.split('-').map(Number);
	const start = new Date(y, m - 1, d);
	const end = new Date(y, m - 1, d + 1);
	return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * Whether `event` overlaps `dayKey`'s local day (review item 2), not merely
 * starts in it — so a carry-over session (e.g. sleep 23:30→01:30) stays
 * visible on both the day it started and the day it ended, matching the
 * server's `listEvents({ overlap: true })` and `SyncStore`'s Today
 * retention. Point events (bottle, diaper) always have a null `endedAt` by
 * design and keep the starts-in-day rule. `dailySummary`'s counts are
 * unaffected — they still attribute to the start day only.
 */
export function eventOverlapsDay(event: EventDTO, dayKey: string, nowMs: number): boolean {
	const { from, to } = dayRangeIso(dayKey);
	const fromMs = Date.parse(from);
	const toMs = Date.parse(to);
	const startedMs = Date.parse(event.startedAt);
	if (startedMs >= toMs) return false;
	if (isTimerType(event.type)) {
		const endMs = event.endedAt === null ? nowMs : Date.parse(event.endedAt);
		return endMs > fromMs;
	}
	return startedMs >= fromMs;
}

export type DailySummary = {
	nursing: { count: number; totalMs: number; leftMs: number; rightMs: number };
	bottle: { count: number; totalMl: number };
	pump: { count: number; totalMl: number };
	diaper: { count: number; pee: number; poo: number };
	sleep: { totalMs: number; completedCount: number; averageMs: number };
};

function startsOnDay(event: EventDTO, dayKey: string): boolean {
	return localDayKey(new Date(Date.parse(event.startedAt))) === dayKey;
}

/** Portion of `[startMs, endMs)` allocated to `dayKey`, 0 if none. */
function shareForDay(startMs: number, endMs: number, dayKey: string): number {
	if (endMs <= startMs) return 0;
	return splitDurationByLocalDay(startMs, endMs).get(dayKey) ?? 0;
}

/**
 * Aggregates one local day's events. Counts attribute an event to the day of
 * its `startedAt`; durations (nursing segments, sleep) are allocated per day
 * via `splitDurationByLocalDay` so a midnight-crossing event stays one entry
 * but each day gets its real share. Sleep `averageMs` uses completed periods
 * only; an open timer contributes to `totalMs` up to `nowMs` but never to
 * `completedCount`.
 */
export function dailySummary(events: EventDTO[], dayKey: string, nowMs: number): DailySummary {
	const nursing = { count: 0, totalMs: 0, leftMs: 0, rightMs: 0 };
	const bottle = { count: 0, totalMl: 0 };
	const pump = { count: 0, totalMl: 0 };
	const diaper = { count: 0, pee: 0, poo: 0 };
	let sleepTotalMs = 0;
	let sleepCompletedCount = 0;
	let sleepCompletedMs = 0;

	for (const event of events) {
		if (event.deletedAt !== null) continue;

		if (isType(event, 'nursing')) {
			const { segments } = event.details;
			let eventShareMs = 0;
			let eventLeftMs = 0;
			let eventRightMs = 0;
			for (const segment of segments) {
				const segStart = Date.parse(segment.startedAt);
				const segEnd = segment.endedAt === null ? nowMs : Date.parse(segment.endedAt);
				const share = shareForDay(segStart, segEnd, dayKey);
				if (share <= 0) continue;
				eventShareMs += share;
				if (segment.side === 'left') eventLeftMs += share;
				else eventRightMs += share;
			}
			// Counted by start day alone (review P3): gating on eventShareMs > 0
			// missed a legal zero-duration session (a segment whose startedAt
			// equals its endedAt, e.g. immediately stopped) — it has a real
			// history row but no allocated duration to gate on.
			if (startsOnDay(event, dayKey)) {
				nursing.count += 1;
			}
			nursing.totalMs += eventShareMs;
			nursing.leftMs += eventLeftMs;
			nursing.rightMs += eventRightMs;
			continue;
		}

		if (isType(event, 'bottle')) {
			if (!startsOnDay(event, dayKey)) continue;
			const details = event.details;
			bottle.count += 1;
			bottle.totalMl += details.volumeMl;
			continue;
		}

		if (isType(event, 'pump')) {
			if (!startsOnDay(event, dayKey)) continue;
			const details = event.details;
			pump.count += 1;
			pump.totalMl += details.volumeMl ?? 0;
			continue;
		}

		if (isType(event, 'diaper')) {
			if (!startsOnDay(event, dayKey)) continue;
			const details = event.details;
			diaper.count += 1;
			if (details.pee) diaper.pee += 1;
			if (details.poo) diaper.poo += 1;
			continue;
		}

		if (event.type === 'sleep') {
			const start = Date.parse(event.startedAt);
			const end = event.endedAt === null ? nowMs : Date.parse(event.endedAt);
			const share = shareForDay(start, end, dayKey);
			sleepTotalMs += share;
			if (event.endedAt !== null && startsOnDay(event, dayKey)) {
				sleepCompletedCount += 1;
				sleepCompletedMs += end - start;
			}
			continue;
		}
	}

	return {
		nursing,
		bottle,
		pump,
		diaper,
		sleep: {
			totalMs: sleepTotalMs,
			completedCount: sleepCompletedCount,
			averageMs: sleepCompletedCount > 0 ? Math.round(sleepCompletedMs / sleepCompletedCount) : 0
		}
	};
}

/**
 * Whether the nursing row should render at all (review item 5): count alone
 * misses a carry-over day, where a session that started the day before
 * allocates duration here (via `splitDurationByLocalDay`) but is counted on
 * its start day only — so a carry-over day showed "Aucun résumé" despite a
 * nonzero nursing duration.
 */
export function hasNursingActivity(nursing: DailySummary['nursing']): boolean {
	return nursing.count > 0 || nursing.totalMs > 0;
}

/** FR-010 display line for nursing: count, total, and the left/right split
 * (omitted when there is no side duration to show). */
export function formatNursingSummary(nursing: DailySummary['nursing']): string {
	const parts = [`${nursing.count} · ${formatElapsed(nursing.totalMs)}`];
	if (nursing.leftMs > 0 || nursing.rightMs > 0) {
		parts.push(`G ${formatElapsed(nursing.leftMs)} / D ${formatElapsed(nursing.rightMs)}`);
	}
	return parts.join(' · ');
}

/** FR-010 display line for sleep: total, plus the completed-period average
 * (omitted while nothing has completed yet — an open timer only contributes
 * to the total, never to the average, same rule as `dailySummary`). */
export function formatSleepSummary(sleep: DailySummary['sleep']): string {
	const parts = [formatElapsed(sleep.totalMs)];
	if (sleep.completedCount > 0) {
		parts.push(`moy. ${formatElapsed(sleep.averageMs)} (${sleep.completedCount})`);
	}
	return parts.join(' · ');
}

/** 7 consecutive local days starting at `mondayKey`. */
export function weeklySummary(
	events: EventDTO[],
	mondayKey: string,
	nowMs: number
): { days: { dayKey: string; summary: DailySummary }[] } {
	const [y, m, d] = mondayKey.split('-').map(Number);
	const days = Array.from({ length: 7 }, (_, i) => {
		const dayKey = localDayKey(new Date(y, m - 1, d + i));
		return { dayKey, summary: dailySummary(events, dayKey, nowMs) };
	});
	return { days };
}

export type WeekTotals = {
	sleepMs: number;
	nursingMs: number;
	nursingCount: number;
	bottleCount: number;
	bottleMl: number;
	diaperCount: number;
};

/** Whole-week totals, for the week-over-week comparison and the 7-day averages. */
export function weekTotals(week: { days: { summary: DailySummary }[] }): WeekTotals {
	return week.days.reduce<WeekTotals>(
		(acc, { summary }) => ({
			sleepMs: acc.sleepMs + summary.sleep.totalMs,
			nursingMs: acc.nursingMs + summary.nursing.totalMs,
			nursingCount: acc.nursingCount + summary.nursing.count,
			bottleCount: acc.bottleCount + summary.bottle.count,
			bottleMl: acc.bottleMl + summary.bottle.totalMl,
			diaperCount: acc.diaperCount + summary.diaper.count
		}),
		{ sleepMs: 0, nursingMs: 0, nursingCount: 0, bottleCount: 0, bottleMl: 0, diaperCount: 0 }
	);
}

/** Signed French delta ("+ 38 min", "− 2", "± 0") — U+2212 minus, not a hyphen. */
export function signedDeltaLabel(
	current: number,
	previous: number,
	format: (value: number) => string = String
): string {
	const diff = current - previous;
	if (diff === 0) return '± 0';
	return `${diff > 0 ? '+' : '−'} ${format(Math.abs(diff))}`;
}
