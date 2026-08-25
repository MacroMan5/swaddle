import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError } from '$lib/server/api';
import { handler } from '$lib/server/http';
import { parseCreateEvent } from '$lib/server/events/types';
import { createEvent, listEvents } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

export const GET: RequestHandler = handler({
	run: ({ db, url }) => {
		const babyId = url.searchParams.get('babyId');
		if (!babyId) return apiError(400, 'validation_failed', 'babyId query parameter is required');
		const events = listEvents(db, {
			babyId,
			from: url.searchParams.get('from') ?? undefined,
			to: url.searchParams.get('to') ?? undefined,
			overlap: url.searchParams.get('overlap') === '1'
		});
		return json({ events });
	}
});

export const POST: RequestHandler = handler({
	schema: (value) => parseCreateEvent(value, new Date()),
	invalidMessage: 'invalid event',
	run: ({ db, body }) => {
		const event = createEvent(db, body);
		publish({ kind: 'created', event });
		return json(event, { status: 201 });
	}
});
