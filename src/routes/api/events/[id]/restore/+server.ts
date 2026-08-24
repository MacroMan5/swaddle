import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { handleRepoError } from '$lib/server/api';
import { restoreEvent } from '$lib/server/events/repo';
import { publish } from '$lib/server/events/broadcast';

export const POST: RequestHandler = ({ params }) => {
	try {
		const event = restoreEvent(getDb(), params.id);
		publish({ kind: 'restored', event });
		return json(event);
	} catch (e) {
		return handleRepoError(e);
	}
};
