import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, handleRepoError } from '$lib/server/api';
import { MAX_FUTURE_MS, TIMER_TYPES, type TimerType } from '$lib/server/events/types';
import { startTimer } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

const startSchema = z.object({
	babyId: z.string().min(1),
	caregiverId: z.string().min(1).nullish(),
	side: z.enum(['left', 'right', 'both']).optional(),
	startedAt: z.iso.datetime().optional()
});

export const POST: RequestHandler = async ({ params, request }) => {
	if (!(TIMER_TYPES as readonly string[]).includes(params.type))
		return apiError(404, 'unknown_timer_type', `no timer type ${params.type}`);
	const type = params.type as TimerType;

	const parsed = startSchema.safeParse(await request.json().catch(() => ({})));
	if (!parsed.success) return apiError(400, 'validation_failed', 'invalid start payload');
	const { babyId, caregiverId, side, startedAt } = parsed.data;
	if (type === 'nursing' && side === 'both')
		return apiError(400, 'validation_failed', 'nursing side must be left or right');
	if (startedAt && Date.parse(startedAt) > Date.now() + MAX_FUTURE_MS)
		return apiError(400, 'validation_failed', 'startedAt is more than 5 minutes in the future');

	try {
		const { created, event } = startTimer(getDb(), { type, babyId, caregiverId, side, startedAt });
		if (created) publish({ kind: 'created', event });
		return json({ created, event }, { status: created ? 201 : 200 });
	} catch (e) {
		return handleRepoError(e);
	}
};
