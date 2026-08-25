import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { restoreEvent } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

export const POST: RequestHandler = handler({
	run: ({ db, params }) => {
		const event = restoreEvent(db, params.id);
		publish({ kind: 'restored', event });
		return json(event);
	}
});
