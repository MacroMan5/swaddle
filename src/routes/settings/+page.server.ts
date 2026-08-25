import type { PageServerLoad } from './$types';
import { DATA_DIR, getDb } from '$lib/server/db';
import { listBabies } from '$lib/server/events/repo';
import { listenerCount } from '$lib/server/events/broadcast';
import { getHousehold, listCaregivers } from '$lib/server/settings/repo';
import { serverInfo } from '$lib/server/settings/serverInfo';

export const load: PageServerLoad = ({ url }) => {
	const db = getDb();
	return {
		household: getHousehold(db),
		caregivers: listCaregivers(db),
		babies: listBabies(db),
		// Direct call (no fetch): rendered with the page, refreshed by the
		// invalidateAll() every mutation already performs.
		serverInfo: serverInfo({ host: url.host, dataDir: DATA_DIR, devices: listenerCount() })
	};
};
