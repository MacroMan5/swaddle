import { z } from 'zod';

export const EVENT_TYPES = ['nursing', 'bottle', 'pump', 'diaper', 'sleep'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// Types driven by a timer; bottle and diaper are point events (endedAt null).
export const TIMER_TYPES = ['nursing', 'pump', 'sleep'] as const;
export type TimerType = (typeof TIMER_TYPES)[number];

export const MAX_FUTURE_MS = 5 * 60 * 1000; // FR-017 / DEC-002

const isoDatetime = z.iso.datetime();
const volumeMl = z.number().min(1).max(1000); // FR-017: [1, 1000] ml
const side = z.enum(['left', 'right']);
export type Side = z.infer<typeof side>;

const segment = z.object({
	side,
	startedAt: isoDatetime,
	endedAt: isoDatetime.nullable()
});
export type NursingSegment = z.infer<typeof segment>;

export const detailsSchemas = {
	nursing: z.object({ segments: z.array(segment) }),
	bottle: z.object({ milkType: z.enum(['breast', 'formula', 'mixed']), volumeMl }),
	pump: z.object({ side: z.enum(['left', 'right', 'both']), volumeMl: volumeMl.nullable() }),
	diaper: z
		.object({ pee: z.boolean(), poo: z.boolean() })
		.refine((d) => d.pee || d.poo, { message: 'a diaper needs at least pee or poo' }),
	sleep: z.strictObject({})
} as const;

export type Details = {
	[K in EventType]: z.infer<(typeof detailsSchemas)[K]>;
}[EventType];

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
export function validateDetailsContext(e: {
	type: EventType;
	endedAt: string | null;
	details: Details;
}): Issue[] {
	const issues: Issue[] = [];

	if (e.type === 'nursing') {
		const { segments } = e.details as { segments: NursingSegment[] };
		if (segments.length === 0)
			issues.push({
				path: 'details.segments',
				code: 'segments_required',
				message: 'a nursing session needs at least one segment'
			});
		segments.forEach((s, i) => {
			if (s.endedAt !== null && Date.parse(s.endedAt) < Date.parse(s.startedAt))
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
		const { volumeMl } = e.details as { volumeMl: number | null };
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

	const isTimerType = (TIMER_TYPES as readonly string[]).includes(type);
	if (isTimerType && endedAt == null)
		issues.push({
			path: 'endedAt',
			code: 'ended_at_required',
			message: `a completed ${type} needs endedAt; use /api/timers for live sessions`
		});
	if (!isTimerType && endedAt != null)
		issues.push({
			path: 'endedAt',
			code: 'ended_at_forbidden',
			message: `${type} is a point event and takes no endedAt`
		});

	const detailsResult = parseDetails(type, details);
	if (!detailsResult.ok) issues.push(...detailsResult.issues);
	else
		issues.push(
			...validateDetailsContext({ type, endedAt: endedAt ?? null, details: detailsResult.value })
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
