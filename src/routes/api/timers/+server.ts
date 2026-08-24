import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { listActiveTimers } from '$lib/server/events/repo';

export const GET: RequestHandler = ({ url }) => {
	const babyId = url.searchParams.get('babyId') ?? undefined;
	return json({
		serverTime: new Date().toISOString(),
		timers: listActiveTimers(getDb(), babyId)
	});
};
