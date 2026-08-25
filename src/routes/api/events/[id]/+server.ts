import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError } from '$lib/server/api';
import { handler } from '$lib/server/http';
import { parsePatchEvent } from '$lib/server/events/types';
import { getEvent, patchEvent, softDeleteEvent } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

export const GET: RequestHandler = handler({
	run: ({ db, params }) => {
		const event = getEvent(db, params.id);
		if (!event) return apiError(404, 'not_found', `no event ${params.id}`);
		return json(event);
	}
});

export const PATCH: RequestHandler = handler({
	schema: parsePatchEvent,
	invalidMessage: 'invalid patch',
	// Read, merge, validate and write happen inside one repo transaction so that
	// overlapping patches cannot both validate against the same stale row.
	run: ({ db, body, params }) => {
		const event = patchEvent(db, params.id, body, new Date());
		publish({ kind: 'updated', event });
		return json(event);
	}
});

export const DELETE: RequestHandler = handler({
	run: ({ db, params }) => {
		const event = softDeleteEvent(db, params.id);
		publish({ kind: 'deleted', event });
		return json(event);
	}
});
