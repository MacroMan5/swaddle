import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { listBabies } from '$lib/server/events/repo';
import { getHousehold, listCaregivers } from '$lib/server/settings/repo';

export const load: PageServerLoad = () => {
	const db = getDb();
	return {
		household: getHousehold(db),
		caregivers: listCaregivers(db),
		babies: listBabies(db)
	};
};
