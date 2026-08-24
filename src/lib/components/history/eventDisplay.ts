// Shared read-only view of an event, used by every history surface: the
// chronological list, the day calendar grid and their accessible names. It
// lives outside the components on purpose — `EventList` and `DayCalendar`
// render the same day two ways, and duplicating these rules would let the two
// drift apart (a bottle counted as durational in one and not the other, a
// different French label for the same session).
import { Baby, Droplets, Milk, Moon, Wind } from '@lucide/svelte';
import { localDayKey } from '$lib/client/summaries';
import { formatElapsed, nursingDurationMs } from '$lib/client/format';
import type {
	BottleDetails,
	DiaperDetails,
	EventDTO,
	NursingDetails,
	PumpDetails
} from '$lib/client/types';

export const ICONS = { nursing: Baby, bottle: Milk, pump: Wind, diaper: Droplets, sleep: Moon } as const;

/** Pastille tint: category is never carried by color alone (an icon rides along). */
export const TINTS = {
	nursing: 'bg-feed-100 text-feed-700',
	bottle: 'bg-feed-100 text-feed-700',
	pump: 'bg-feed-100 text-feed-700',
	diaper: 'bg-diaper-100 text-diaper-700',
	sleep: 'bg-sleep-100 text-sleep-700'
} as const;

/** Calendar bar for a block too thin to hold text: saturated, so a 5 px sliver
 * still reads as an event rather than a hairline rule. */
export const BLOCK_BARS = {
	nursing: 'bg-feed-500',
	bottle: 'bg-feed-500',
	pump: 'bg-feed-500',
	diaper: 'bg-diaper-500',
	sleep: 'bg-sleep-500'
} as const;

/** Calendar block fill, border and text once there is room for a label — a
 * light tint keeps that label readable (NFR-008: one token trio per category). */
export const BLOCK_TONES = {
	nursing: 'bg-feed-100 border-feed-500 text-feed-700',
	bottle: 'bg-feed-100 border-feed-500 text-feed-700',
	pump: 'bg-feed-100 border-feed-500 text-feed-700',
	diaper: 'bg-diaper-100 border-diaper-500 text-diaper-700',
	sleep: 'bg-sleep-100 border-sleep-500 text-sleep-700'
} as const;

/** Bottle and diaper happen at an instant: they never have a duration. */
export function isPointEvent(event: EventDTO): boolean {
	return event.type === 'bottle' || event.type === 'diaper';
}

/** End of a durational event, bounding a still-running timer at `nowMs`. */
export function effectiveEndMs(event: EventDTO, nowMs: number): number {
	return event.endedAt === null ? nowMs : Date.parse(event.endedAt);
}

/** True for a carry-over row: the event overlaps `dayKey` but started the day
 * before, so its displayed clock time reads "yesterday" without this hint. */
export function startsBeforeDay(event: EventDTO, dayKey: string): boolean {
	return localDayKey(new Date(Date.parse(event.startedAt))) !== dayKey;
}

export function endsAfterDay(event: EventDTO, dayKey: string): boolean {
	if (event.endedAt === null) return false;
	return localDayKey(new Date(Date.parse(event.endedAt))) !== dayKey;
}

/** The noun alone, with no details attached. */
export function typeLabel(event: EventDTO): string {
	switch (event.type) {
		case 'nursing':
			return 'Allaitement';
		case 'bottle':
			return 'Biberon';
		case 'pump':
			return 'Tire-lait';
		case 'diaper':
			return 'Couche';
		case 'sleep':
			return 'Sommeil';
	}
}

export function diaperLabel(details: DiaperDetails): string {
	if (details.pee && details.poo) return 'Pipi et caca';
	if (details.poo) return 'Caca';
	return 'Pipi';
}

/** Sides touched during a session: "G", "D", "G+D", or "" if it has no segment. */
export function nursingSides(details: NursingDetails): string {
	const sides = new Set(details.segments.map((s) => s.side));
	const parts: string[] = [];
	if (sides.has('left')) parts.push('G');
	if (sides.has('right')) parts.push('D');
	return parts.join('+');
}

/** Duration of a durational event; nursing excludes paused time (DEC-001). */
export function durationMs(event: EventDTO, nowMs: number): number {
	if (event.type === 'nursing')
		return nursingDurationMs((event.details as NursingDetails).segments, nowMs);
	return Math.max(0, effectiveEndMs(event, nowMs) - Date.parse(event.startedAt));
}

/** One-line description, without the time — the time is rendered separately. */
export function eventLabel(event: EventDTO, nowMs: number): string {
	switch (event.type) {
		case 'bottle': {
			const d = event.details as BottleDetails;
			return `Biberon · ${d.volumeMl} ml`;
		}
		case 'nursing': {
			const d = event.details as NursingDetails;
			return `Allaitement · ${formatElapsed(durationMs(event, nowMs))} · ${nursingSides(d)}`;
		}
		case 'pump': {
			const d = event.details as PumpDetails;
			return d.volumeMl === null ? 'Tire-lait · en cours' : `Tire-lait · ${d.volumeMl} ml`;
		}
		case 'diaper':
			return `Couche · ${diaperLabel(event.details as DiaperDetails)}`;
		case 'sleep':
			return `Sommeil · ${formatElapsed(durationMs(event, nowMs))}`;
	}
}
