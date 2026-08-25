import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { exportJson } from '$lib/server/settings/transfer';

export const GET: RequestHandler = handler({
	run: ({ db }) => {
		const data = exportJson(db);
		const date = data.exportedAt.slice(0, 10);
		return json(data, {
			headers: { 'content-disposition': `attachment; filename="swaddle-export-${date}.json"` }
		});
	}
});
