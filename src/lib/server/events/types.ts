import { z } from 'zod';
import { detailsOf, EVENT_TYPES, isTimerType } from '$lib/shared/events';
import type { DetailsByType, Details, EventType } from '$lib/shared/events';

// The event vocabulary and the shape of `details` are defined once, in
// `$lib/shared/events`; this module only adds the runtime validation of the
// wire payloads on top of them.
export {
	EVENT_TYPES,
	TIMER_TYPES,
	POINT_TYPES,
	isTimerType,
	isPointType,
	isType,
	detailsOf
} from '$lib/shared/events';
export type {
	EventType,
	TimerType,
	PointType,
	Side,
	PumpSide,
	MilkType,
	NursingSegment,
	DetailsByType,
	Details,
	EventDTO,
	TypedEvent
} from '$lib/shared/events';

export const MAX_FUTURE_MS = 5 * 60 * 1000; // FR-017 / DEC-002

const isoDatetime = z.iso.datetime();
const volumeMl = z.number().min(1).max(1000); // FR-017: [1, 1000] ml
const side = z.enum(['left', 'right']);

const segment = z.object({
	side,
	startedAt: isoDatetime,
	endedAt: isoDatetime.nullable()
});

export const detailsSchemas = {
	nursing: z.object({ segments: z.array(segment) }),
	bottle: z.object({ milkType: z.enum(['breast', 'formula', 'mixed']), volumeMl }),
	pump: z.object({ side: z.enum(['left', 'right', 'both']), volumeMl: volumeMl.nullable() }),
	diaper: z
		.object({ pee: z.boolean(), poo: z.boolean() })
		.refine((d) => d.pee || d.poo, { message: 'a diaper needs at least pee or poo' }),
	sleep: z.strictObject({})
} as const;

// Static concordance check: every schema above must still infer exactly the
// hand-written type it validates, or the shared contract and the wire
// validation have drifted apart. A mismatch is a compile error here, which is
// the only place that can see both sides.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _nursingMatches: Exact<z.infer<typeof detailsSchemas.nursing>, DetailsByType['nursing']> =
	true;
const _bottleMatches: Exact<z.infer<typeof detailsSchemas.bottle>, DetailsByType['bottle']> = true;
const _pumpMatches: Exact<z.infer<typeof detailsSchemas.pump>, DetailsByType['pump']> = true;
const _diaperMatches: Exact<z.infer<typeof detailsSchemas.diaper>, DetailsByType['diaper']> = true;
const _sleepMatches: Exact<z.infer<typeof detailsSchemas.sleep>, DetailsByType['sleep']> = true;
void [_nursingMatches, _bottleMatches, _pumpMatches, _diaperMatches, _sleepMatches];

export type BabyDTO = { id: string; name: string; birthdate: string; timezone: string };

export type Issue = { path: string; code: string; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

const createEventSchema = z.object({
	babyId: z.string().min(1),
	caregiverId: z.string().min(1).nullish(),
	type: z.enum(EVENT_TYPES),
	startedAt: isoDatetime,
	endedAt: isoDatetime.nullish(),
	note: z.string().max(1000).nullish(),
	details: z.unknown()
});
export type CreateEventInput = {
	babyId: string;
	caregiverId: string | null;
	type: EventType;
	startedAt: string;
	endedAt: string | null;
	note: string | null;
	details: Details;
};

const patchEventSchema = z.strictObject({
	caregiverId: z.string().min(1).nullish(),
	startedAt: isoDatetime.optional(),
	// null is rejected: reopening a finished timer would bypass the unique-timer invariant.
	endedAt: isoDatetime.optional(),
	note: z.string().max(1000).nullish(),
	details: z.unknown().optional()
});
export type PatchEventInput = z.infer<typeof patchEventSchema>;

function zodIssues(error: z.ZodError): Issue[] {
	return error.issues.map((i) => ({
		path: i.path.join('.'),
		code: i.code,
		message: i.message
	}));
}

/** FR-017 time rules, shared by create and patched-merge validation. */
export function validateEventTimes(
	e: { type: EventType; startedAt: string; endedAt: string | null },
	now: Date
): Issue[] {
	const issues: Issue[] = [];
	const max = now.getTime() + MAX_FUTURE_MS;
	if (Date.parse(e.startedAt) > max)
		issues.push({
			path: 'startedAt',
			code: 'too_far_in_future',
			message: 'startedAt is more than 5 minutes in the future'
		});
	if (e.endedAt !== null) {
		if (Date.parse(e.endedAt) > max)
			issues.push({
				path: 'endedAt',
				code: 'too_far_in_future',
				message: 'endedAt is more than 5 minutes in the future'
			});
		if (Date.parse(e.endedAt) < Date.parse(e.startedAt))
			issues.push({
				path: 'endedAt',
				code: 'end_before_start',
				message: 'endedAt is before startedAt'
			});
	}
	return issues;
}

/**
 * Rules that depend on the completion state of the event, not just on the shape
 * of `details`. Shared by create and patch so both entry points agree.
 */
export function validateDetailsContext(
	e: {
		type: EventType;
		startedAt: string;
		endedAt: string | null;
		details: Details;
	},
	now: Date
): Issue[] {
	const issues: Issue[] = [];
	const maxTime = now.getTime() + MAX_FUTURE_MS;

	if (e.type === 'nursing') {
		const { segments } = detailsOf(e, 'nursing');
		if (segments.length === 0)
			issues.push({
				path: 'details.segments',
				code: 'segments_required',
				message: 'a nursing session needs at least one segment'
			});
		const sessionStart = Date.parse(e.startedAt);
		const sessionEnd = e.endedAt === null ? null : Date.parse(e.endedAt);
		// Tracks the previous segment's end to enforce chronological,
		// non-overlapping segments (review item 7); an open segment (only
		// legal on the last one) has no end to compare against, so nothing
		// after it is checked — there is nothing after it by construction.
		let prevEnd: number | null = null;
		segments.forEach((s, i) => {
			const segStart = Date.parse(s.startedAt);
			const segEnd = s.endedAt === null ? null : Date.parse(s.endedAt);
			// Segments obey the same FR-017 future bound as the event itself.
			if (segStart > maxTime || (segEnd !== null && segEnd > maxTime))
				issues.push({
					path: `details.segments.${i}`,
					code: 'too_far_in_future',
					message: 'segment timestamps are more than 5 minutes in the future'
				});
			if (segEnd !== null && segEnd < segStart)
				issues.push({
					path: `details.segments.${i}.endedAt`,
					code: 'end_before_start',
					message: 'segment endedAt is before its startedAt'
				});
			// Only the last segment may be open, which also forbids several open ones.
			if (s.endedAt === null && i !== segments.length - 1)
				issues.push({
					path: `details.segments.${i}.endedAt`,
					code: 'segment_still_open',
					message: 'only the last segment may be open'
				});
			// Contained within [startedAt, endedAt] of the session (review item 7):
			// summaries split duration per day assuming segments never spill
			// outside their own session, so an out-of-bounds segment would
			// silently double-count or misattribute time.
			if (segStart < sessionStart)
				issues.push({
					path: `details.segments.${i}.startedAt`,
					code: 'segment_out_of_bounds',
					message: 'segment starts before the session started'
				});
			if (sessionEnd !== null && segEnd !== null && segEnd > sessionEnd)
				issues.push({
					path: `details.segments.${i}.endedAt`,
					code: 'segment_out_of_bounds',
					message: 'segment ends after the session ended'
				});
			// Chronological and non-overlapping: each segment must start no
			// earlier than the previous one ended.
			if (prevEnd !== null && segStart < prevEnd)
				issues.push({
					path: `details.segments.${i}.startedAt`,
					code: 'segment_overlap',
					message: 'segments must be chronological and must not overlap'
				});
			prevEnd = segEnd;
		});
		if (e.endedAt !== null && segments.some((s) => s.endedAt === null))
			issues.push({
				path: 'details.segments',
				code: 'segment_still_open',
				message: 'a completed nursing session cannot keep an open segment'
			});
	}

	// FR-004: the pumped volume is entered when the session ends; null is only
	// legal while the timer is still running.
	if (e.type === 'pump' && e.endedAt !== null) {
		const { volumeMl } = detailsOf(e, 'pump');
		if (volumeMl === null)
			issues.push({
				path: 'details.volumeMl',
				code: 'volume_required',
				message: 'a completed pump needs a volume in [1, 1000] ml'
			});
	}

	return issues;
}

/** Details must match the event type. Returns issues or the parsed details. */
export function parseDetails(type: EventType, details: unknown): Result<Details> {
	const parsed = detailsSchemas[type].safeParse(details);
	if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
	return { ok: true, value: parsed.data as Details };
}

export function parseCreateEvent(input: unknown, now: Date): Result<CreateEventInput> {
	const parsed = createEventSchema.safeParse(input);
	if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
	const { babyId, caregiverId, type, startedAt, endedAt, note, details } = parsed.data;
	const issues: Issue[] = [];

	const timerType = isTimerType(type);
	if (timerType && endedAt == null)
		issues.push({
			path: 'endedAt',
			code: 'ended_at_required',
			message: `a completed ${type} needs endedAt; use /api/timers for live sessions`
		});
	if (!timerType && endedAt != null)
		issues.push({
			path: 'endedAt',
			code: 'ended_at_forbidden',
			message: `${type} is a point event and takes no endedAt`
		});

	const detailsResult = parseDetails(type, details);
	if (!detailsResult.ok) issues.push(...detailsResult.issues);
	else
		issues.push(
			...validateDetailsContext(
					{ type, startedAt, endedAt: endedAt ?? null, details: detailsResult.value },
					now
				)
		);

	issues.push(...validateEventTimes({ type, startedAt, endedAt: endedAt ?? null }, now));
	if (issues.length > 0) return { ok: false, issues };
	return {
		ok: true,
		value: {
			babyId,
			caregiverId: caregiverId ?? null,
			type,
			startedAt,
			endedAt: endedAt ?? null,
			note: note ?? null,
			details: (detailsResult as { ok: true; value: Details }).value
		}
	};
}

export function parsePatchEvent(input: unknown): Result<PatchEventInput> {
	const parsed = patchEventSchema.safeParse(input);
	if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
	return { ok: true, value: parsed.data };
}
