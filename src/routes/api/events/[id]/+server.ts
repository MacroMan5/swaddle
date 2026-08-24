import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, handleRepoError, readJson } from '$lib/server/api';
import { parsePatchEvent } from '$lib/server/events/types';
import { getEvent, patchEvent, softDeleteEvent } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

export const GET: RequestHandler = ({ params }) => {
	const event = getEvent(getDb(), params.id);
	if (!event) return apiError(404, 'not_found', `no event ${params.id}`);
	return json(event);
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await readJson(request);
	if (!body.ok) return apiError(400, 'validation_failed', 'invalid patch', body.issues);

	const parsed = parsePatchEvent(body.value);
	if (!parsed.ok) return apiError(400, 'validation_failed', 'invalid patch', parsed.issues);

	// Read, merge, validate and write happen inside one repo transaction so that
	// overlapping patches cannot both validate against the same stale row.
	try {
		const event = patchEvent(getDb(), params.id, parsed.value, new Date());
		publish({ kind: 'updated', event });
		return json(event);
	} catch (e) {
		return handleRepoError(e);
	}
};

export const DELETE: RequestHandler = ({ params }) => {
	try {
		const event = softDeleteEvent(getDb(), params.id);
		publish({ kind: 'deleted', event });
		return json(event);
	} catch (e) {
		return handleRepoError(e);
	}
};
