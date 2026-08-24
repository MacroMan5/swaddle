import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { listBabies } from '$lib/server/events/repo';

export const GET: RequestHandler = () => {
	return json({ babies: listBabies(getDb()) });
};
