import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestHandler } from './$types';
import { DATA_DIR, getDb } from '$lib/server/db';
import { snapshotTo } from '$lib/server/settings/transfer';

export const GET: RequestHandler = () => {
	const stamp = new Date().toISOString().replace(/:/g, '-');
	const path = join(DATA_DIR, 'backups', `backup-${stamp}.sqlite`);
	snapshotTo(getDb(), path);
	const buffer = readFileSync(path);
	return new Response(buffer, {
		headers: {
			'content-type': 'application/octet-stream',
			'content-disposition': `attachment; filename="backup-${stamp}.sqlite"`
		}
	});
};
