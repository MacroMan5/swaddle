import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, handleRepoError } from '$lib/server/api';
import { MAX_FUTURE_MS, TIMER_TYPES, type TimerType } from '$lib/server/events/types';
import { stopTimer } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

const stopSchema = z.object({
	babyId: z.string().min(1),
	endedAt: z.iso.datetime().optional(),
	volumeMl: z.number().min(1).max(1000).nullish() // FR-017
});

export const POST: RequestHandler = async ({ params, request }) => {
	if (!(TIMER_TYPES as readonly string[]).includes(params.type))
		return apiError(404, 'unknown_timer_type', `no timer type ${params.type}`);
	const type = params.type as TimerType;

	const parsed = stopSchema.safeParse(await request.json().catch(() => ({})));
	if (!parsed.success) return apiError(400, 'validation_failed', 'invalid stop payload');
	const { babyId, endedAt, volumeMl } = parsed.data;
	if (endedAt && Date.parse(endedAt) > Date.now() + MAX_FUTURE_MS)
		return apiError(400, 'validation_failed', 'endedAt is more than 5 minutes in the future');

	try {
		const event = stopTimer(getDb(), { type, babyId, endedAt, volumeMl });
		publish({ kind: 'updated', event });
		return json(event);
	} catch (e) {
		return handleRepoError(e);
	}
};
