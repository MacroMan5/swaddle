import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { apiError } from '$lib/server/api';
import { handler } from '$lib/server/http';
import { MAX_FUTURE_MS, TIMER_TYPES, type TimerType } from '$lib/server/events/types';
import { startTimer } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

const startSchema = z.object({
	babyId: z.string().min(1),
	caregiverId: z.string().min(1).nullish(),
	side: z.enum(['left', 'right', 'both']).optional(),
	startedAt: z.iso.datetime().optional()
});

const start = handler({
	schema: startSchema,
	invalidMessage: 'invalid start payload',
	// TODO: unify with the standard error contract (tracked outside this refactor)
	detail: 'message',
	run: ({ db, body, params }) => {
		const type = params.type as TimerType;
		const { babyId, caregiverId, side, startedAt } = body;
		if (type === 'nursing' && side === 'both')
			return apiError(400, 'validation_failed', 'nursing side must be left or right');
		if (startedAt && Date.parse(startedAt) > Date.now() + MAX_FUTURE_MS)
			return apiError(400, 'validation_failed', 'startedAt is more than 5 minutes in the future');

		const { created, event } = startTimer(db, { type, babyId, caregiverId, side, startedAt });
		if (created) publish({ kind: 'created', event });
		return json({ created, event }, { status: created ? 201 : 200 });
	}
});

// The unknown-type 404 answers before the body is even read, so it wraps the
// handler instead of living inside it.
export const POST: RequestHandler = (event) => {
	if (!(TIMER_TYPES as readonly string[]).includes(event.params.type))
		return apiError(404, 'unknown_timer_type', `no timer type ${event.params.type}`);
	return start(event);
};
