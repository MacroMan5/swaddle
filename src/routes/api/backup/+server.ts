import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestHandler } from './$types';
import { DATA_DIR } from '$lib/server/db';
import { handler } from '$lib/server/http';
import { pruneSnapshots } from '$lib/server/settings/retention';
import { snapshotTo } from '$lib/server/settings/transfer';

export const GET: RequestHandler = handler({
	run: ({ db }) => {
		const stamp = new Date().toISOString().replace(/:/g, '-');
		const backupsDir = join(DATA_DIR, 'backups');
		const path = join(backupsDir, `backup-${stamp}.sqlite`);
		snapshotTo(db, path);
		// #57: prune only after the new snapshot is on disk, so a pruning
		// failure never costs the backup that was just requested.
		pruneSnapshots(backupsDir, 'backup');
		const buffer = readFileSync(path);
		return new Response(buffer, {
			headers: {
				'content-type': 'application/octet-stream',
				'content-disposition': `attachment; filename="backup-${stamp}.sqlite"`
			}
		});
	}
});
