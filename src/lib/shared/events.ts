// Single source of truth for the event contract (docs/api/events-api.md):
// the type vocabulary, the shape of the JSON `details` payload per type, and
// the guards that read it. Shared verbatim by client and server, so a change
// to the contract cannot land on one side only.
//
// Deliberately dependency-free (no zod, no `$lib/server/*`, no rune) and free
// of side effects: the server layer builds its zod schemas on top of these
// types and asserts they still agree, the client imports them directly.

export const EVENT_TYPES = ['nursing', 'bottle', 'pump', 'diaper', 'sleep'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Types driven by a timer: they own a start, an end, and an active state. */
export const TIMER_TYPES = ['nursing', 'pump', 'sleep'] as const;
export type TimerType = (typeof TIMER_TYPES)[number];

/** Types that happen at an instant: `endedAt` is null by design, not by state. */
export const POINT_TYPES = ['bottle', 'diaper'] as const;
export type PointType = (typeof POINT_TYPES)[number];

export function isTimerType(type: string): type is TimerType {
	return (TIMER_TYPES as readonly string[]).includes(type);
}

export function isPointType(type: string): type is PointType {
	return (POINT_TYPES as readonly string[]).includes(type);
}

/**
 * How the UI groups event types (status strip, "since last…" rows). Distinct
 * from the timer/point split on purpose: a bottle is a feed even though it is
 * a point event, and a pump is a feed even though it is a timer.
 */
export type Category = 'feed' | 'diaper' | 'sleep';

export const CATEGORY_OF: Record<EventType, Category> = {
	nursing: 'feed',
	bottle: 'feed',
	pump: 'feed',
	diaper: 'diaper',
	sleep: 'sleep'
};

export type Side = 'left' | 'right';
export type PumpSide = Side | 'both';
export type MilkType = 'breast' | 'formula' | 'mixed';

export type NursingSegment = { side: Side; startedAt: string; endedAt: string | null };

export type NursingDetails = { segments: NursingSegment[] };
export type BottleDetails = { milkType: MilkType; volumeMl: number };
export type PumpDetails = { side: PumpSide; volumeMl: number | null };
export type DiaperDetails = { pee: boolean; poo: boolean };
export type SleepDetails = Record<string, never>;

/** The `details` payload each event type carries. */
export type DetailsByType = {
	nursing: NursingDetails;
	bottle: BottleDetails;
	pump: PumpDetails;
	diaper: DiaperDetails;
	sleep: SleepDetails;
};

export type Details = DetailsByType[EventType];

export type EventDTO = {
	id: string;
	babyId: string;
	caregiverId: string | null;
	type: EventType;
	startedAt: string;
	endedAt: string | null;
	note: string | null;
	details: Details;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
};

/** An `EventDTO` whose `type` is known, and whose `details` follow from it. */
export type TypedEvent<T extends EventType> = EventDTO & { type: T; details: DetailsByType[T] };

/** Narrowing guard: pairs `type` with the matching `details` shape. */
export function isType<T extends EventType>(event: EventDTO, type: T): event is TypedEvent<T> {
	return event.type === type;
}

/** Anything carrying the type/details pair — a full DTO, or an event being
 * validated before it has an id. */
export type EventLike = { type: EventType; details: Details };

/**
 * `details` read through the type that guarantees its shape. Throws rather
 * than casting blindly, so a mismatch surfaces where it happens instead of as
 * an undefined field somewhere downstream. This is the single place allowed to
 * assert the pairing, and it checks it first.
 */
export function detailsOf<T extends EventType>(event: EventLike, type: T): DetailsByType[T] {
	if (event.type !== type)
		throw new TypeError(`expected a ${type} event, got ${event.type}`);
	return event.details as DetailsByType[T];
}

/**
 * Effective nursing duration (DEC-001): the sum of segment durations, so
 * paused time is excluded by construction — a session of 10 min, a 30 min
 * pause and 5 min lasted 15 minutes of feeding, not 45 of wall clock. An open
 * segment counts up to `nowMs`.
 *
 * Part of the contract rather than of either side's presentation layer: the
 * client shows this number on the Today screen and in the history, and the
 * server speaks it back on `/api/quick`. One definition, both sides.
 */
export function nursingDurationMs(
	// Structurally typed, not `NursingSegment[]`: only the interval matters, so
	// callers holding a bare start/end pair need not carry a side.
	segments: { startedAt: string; endedAt: string | null }[],
	nowMs: number
): number {
	return segments.reduce((sum, s) => {
		const end = s.endedAt === null ? nowMs : Date.parse(s.endedAt);
		return sum + Math.max(0, end - Date.parse(s.startedAt));
	}, 0);
}
