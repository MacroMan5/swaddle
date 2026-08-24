import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, handleRepoError, readJson } from '$lib/server/api';
import { nursingAction } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

const actionSchema = z.object({
	babyId: z.string().min(1),
	action: z.enum(['pause', 'resume', 'switch-side']),
	side: z.enum(['left', 'right']).optional()
});

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	if (!body.ok) return apiError(400, 'validation_failed', 'invalid action payload', body.issues);
	const parsed = actionSchema.safeParse(body.value);
	if (!parsed.success) return apiError(400, 'validation_failed', 'invalid action payload');
	try {
		const event = nursingAction(getDb(), parsed.data);
		publish({ kind: 'updated', event });
		return json(event);
	} catch (e) {
		return handleRepoError(e);
	}
};
