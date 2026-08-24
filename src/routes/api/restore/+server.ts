import { json } from '@sveltejs/kit';
import { join } from 'node:path';
import type { RequestHandler } from './$types';
import { DATA_DIR, getDb } from '$lib/server/db';
import { apiError, handleRepoError, readJson } from '$lib/server/api';
import { publishReset } from '$lib/server/events/broadcast';
import { importJson, snapshotTo } from '$lib/server/settings/transfer';

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	if (!body.ok) return apiError(400, 'validation_failed', 'invalid restore payload', body.issues);

	const db = getDb();
	const stamp = new Date().toISOString().replace(/:/g, '-');
	const snapshotPath = join(DATA_DIR, 'backups', `pre-restore-${stamp}.sqlite`);
	// FR-014: an automatic snapshot of the current state is always taken first.
	snapshotTo(db, snapshotPath);

	try {
		const restored = importJson(db, body.value);
		// Any device with an open SSE connection has stale timers/lists after a
		// restore: tell it to refetch instead of trusting incremental sync.
		publishReset();
		return json({ restored, snapshot: snapshotPath });
	} catch (e) {
		return handleRepoError(e);
	}
};
