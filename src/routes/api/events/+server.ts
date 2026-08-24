import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, handleRepoError, readJson } from '$lib/server/api';
import { parseCreateEvent } from '$lib/server/events/types';
import { createEvent, listEvents } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

export const GET: RequestHandler = ({ url }) => {
	const babyId = url.searchParams.get('babyId');
	if (!babyId) return apiError(400, 'validation_failed', 'babyId query parameter is required');
	const events = listEvents(getDb(), {
		babyId,
		from: url.searchParams.get('from') ?? undefined,
		to: url.searchParams.get('to') ?? undefined
	});
	return json({ events });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	if (!body.ok) return apiError(400, 'validation_failed', 'invalid event', body.issues);

	const parsed = parseCreateEvent(body.value, new Date());
	if (!parsed.ok) return apiError(400, 'validation_failed', 'invalid event', parsed.issues);
	try {
		const event = createEvent(getDb(), parsed.value);
		publish({ kind: 'created', event });
		return json(event, { status: 201 });
	} catch (e) {
		return handleRepoError(e);
	}
};
