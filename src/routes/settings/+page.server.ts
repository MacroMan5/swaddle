import type { PageServerLoad } from './$types';
import { DATA_DIR, getDb } from '$lib/server/db';
import { listBabies } from '$lib/server/events/repo';
import { listenerCount } from '$lib/server/events/broadcast';
import { listQuickWords } from '$lib/server/quick/words';
import { listApiTokens } from '$lib/server/settings/apiTokens';
import { getHousehold, listCaregivers } from '$lib/server/settings/repo';
import { serverInfo } from '$lib/server/settings/serverInfo';

export const load: PageServerLoad = ({ url }) => {
	const db = getDb();
	return {
		household: getHousehold(db),
		caregivers: listCaregivers(db),
		babies: listBabies(db),
		// Never the plaintext nor the hash (#97): the list is names, links and
		// last contact only.
		apiTokens: listApiTokens(db),
		// The words the `phrase` intent is resolved against (#99); read on every
		// dictation too, so this list is always what the server understands.
		quickWords: listQuickWords(db),
		// Direct call (no fetch): rendered with the page, refreshed by the
		// invalidateAll() every mutation already performs.
		serverInfo: serverInfo({ host: url.host, dataDir: DATA_DIR, devices: listenerCount() })
	};
};
