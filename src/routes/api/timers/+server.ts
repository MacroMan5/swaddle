import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { listActiveTimers } from '$lib/server/events/repo';

export const GET: RequestHandler = handler({
	run: ({ db, url }) => {
		const babyId = url.searchParams.get('babyId') ?? undefined;
		return json({
			serverTime: new Date().toISOString(),
			timers: listActiveTimers(db, babyId)
		});
	}
});
