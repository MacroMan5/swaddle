import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestHandler } from './$types';
import { DATA_DIR } from '$lib/server/db';
import { handler } from '$lib/server/http';
import { snapshotTo } from '$lib/server/settings/transfer';

export const GET: RequestHandler = handler({
	run: ({ db }) => {
		const stamp = new Date().toISOString().replace(/:/g, '-');
		const path = join(DATA_DIR, 'backups', `backup-${stamp}.sqlite`);
		snapshotTo(db, path);
		const buffer = readFileSync(path);
		return new Response(buffer, {
			headers: {
				'content-type': 'application/octet-stream',
				'content-disposition': `attachment; filename="backup-${stamp}.sqlite"`
			}
		});
	}
});
