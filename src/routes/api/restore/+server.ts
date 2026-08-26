import { json } from '@sveltejs/kit';
import { join } from 'node:path';
import type { RequestHandler } from './$types';
import { DATA_DIR } from '$lib/server/db';
import { handler } from '$lib/server/http';
import { publishReset } from '$lib/server/events/broadcast';
import { pruneSnapshots } from '$lib/server/settings/retention';
import { importJson, snapshotTo } from '$lib/server/settings/transfer';

export const POST: RequestHandler = handler<unknown>({
	// The payload itself is validated by `importJson`; the schema step only
	// turns an unreadable body into the 400 envelope, before the snapshot.
	schema: (value) => ({ ok: true, value }),
	invalidMessage: 'invalid restore payload',
	run: ({ db, body }) => {
		const stamp = new Date().toISOString().replace(/:/g, '-');
		const backupsDir = join(DATA_DIR, 'backups');
		const snapshotPath = join(backupsDir, `pre-restore-${stamp}.sqlite`);
		// FR-014: an automatic snapshot of the current state is always taken first.
		snapshotTo(db, snapshotPath);
		// #57: prune before the data replacement proceeds, not after — the
		// snapshot just taken is what pruning must never be able to cost, and
		// it's passed as protected so it survives even if its mtime somehow
		// isn't the newest (clock skew, future-dated files in the directory) —
		// the response below reports this exact path as the recovery point.
		pruneSnapshots(backupsDir, 'pre-restore', undefined, snapshotPath);

		const restored = importJson(db, body);
		// Any device with an open SSE connection has stale timers/lists after a
		// restore: tell it to refetch instead of trusting incremental sync.
		publishReset();
		return json({ restored, snapshot: snapshotPath });
	}
});
