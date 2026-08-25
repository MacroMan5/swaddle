import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { nursingAction } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

const actionSchema = z.object({
	babyId: z.string().min(1),
	action: z.enum(['pause', 'resume', 'switch-side']),
	side: z.enum(['left', 'right']).optional()
});

export const POST: RequestHandler = handler({
	schema: actionSchema,
	invalidMessage: 'invalid action payload',
	// TODO: unify with the standard error contract (tracked outside this refactor)
	detail: 'message',
	run: ({ db, body }) => {
		const event = nursingAction(db, body);
		publish({ kind: 'updated', event });
		return json(event);
	}
});
