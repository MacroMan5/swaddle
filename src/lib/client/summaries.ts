// Pure day-splitting summaries engine (FR-010, AC-006). Feeds both the Today
// SummaryCard and the History day/week views — one source of truth so counts
// and durations never disagree between screens.
import type {
	BottleDetails,
	DiaperDetails,
	EventDTO,
	NursingDetails,
	PumpDetails
} from './types';

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

		if (event.type === 'nursing') {
			const { segments } = event.details as NursingDetails;
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
			if (eventShareMs > 0 && startsOnDay(event, dayKey)) {
				nursing.count += 1;
			}
			nursing.totalMs += eventShareMs;
			nursing.leftMs += eventLeftMs;
			nursing.rightMs += eventRightMs;
			continue;
		}

		if (event.type === 'bottle') {
			if (!startsOnDay(event, dayKey)) continue;
			const details = event.details as BottleDetails;
			bottle.count += 1;
			bottle.totalMl += details.volumeMl;
			continue;
		}

		if (event.type === 'pump') {
			if (!startsOnDay(event, dayKey)) continue;
			const details = event.details as PumpDetails;
			pump.count += 1;
			pump.totalMl += details.volumeMl ?? 0;
			continue;
		}

		if (event.type === 'diaper') {
			if (!startsOnDay(event, dayKey)) continue;
			const details = event.details as DiaperDetails;
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
