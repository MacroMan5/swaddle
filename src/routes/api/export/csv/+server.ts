import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { exportCsv } from '$lib/server/settings/transfer';

export const GET: RequestHandler = handler({
	run: ({ db }) => {
		const csv = exportCsv(db);
		const date = new Date().toISOString().slice(0, 10);
		return new Response(csv, {
			headers: {
				'content-type': 'text/csv; charset=utf-8',
				'content-disposition': `attachment; filename="swaddle-export-${date}.csv"`
			}
		});
	}
});
