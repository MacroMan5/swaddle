import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { exportJson } from '$lib/server/settings/transfer';

export const GET: RequestHandler = () => {
	const data = exportJson(getDb());
	const date = data.exportedAt.slice(0, 10);
	return json(data, {
		headers: { 'content-disposition': `attachment; filename="swaddle-export-${date}.json"` }
	});
};
