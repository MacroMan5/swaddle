import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { apiError } from '$lib/server/api';
import { handler } from '$lib/server/http';
import { MAX_FUTURE_MS, TIMER_TYPES, type TimerType } from '$lib/server/events/types';
import { stopTimer } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

const stopSchema = z.object({
	babyId: z.string().min(1),
	endedAt: z.iso.datetime().optional(),
	volumeMl: z.number().min(1).max(1000).nullish() // FR-017
});

const stop = handler({
	schema: stopSchema,
	invalidMessage: 'invalid stop payload',
	// TODO: unify with the standard error contract (tracked outside this refactor)
	detail: 'message',
	run: ({ db, body, params }) => {
		const type = params.type as TimerType;
		const { babyId, endedAt, volumeMl } = body;
		if (endedAt && Date.parse(endedAt) > Date.now() + MAX_FUTURE_MS)
			return apiError(400, 'validation_failed', 'endedAt is more than 5 minutes in the future');

		const event = stopTimer(db, { type, babyId, endedAt, volumeMl });
		publish({ kind: 'updated', event });
		return json(event);
	}
});

// The unknown-type 404 answers before the body is even read, so it wraps the
// handler instead of living inside it.
export const POST: RequestHandler = (event) => {
	if (!(TIMER_TYPES as readonly string[]).includes(event.params.type))
		return apiError(404, 'unknown_timer_type', `no timer type ${event.params.type}`);
	return stop(event);
};
