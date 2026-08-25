import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { DATA_DIR } from '$lib/server/db';
import { handler } from '$lib/server/http';
import { listenerCount } from '$lib/server/events/broadcast';
import { serverInfo } from '$lib/server/settings/serverInfo';

export const GET: RequestHandler = handler({
	run: ({ url }) =>
		json(serverInfo({ host: url.host, dataDir: DATA_DIR, devices: listenerCount() }))
});
