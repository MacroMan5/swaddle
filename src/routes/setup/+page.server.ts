import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { listBabies } from '$lib/server/events/repo';

// Wizard state lives client-only otherwise: a reload right after the baby is
// created (step 1) would restart at step 1 and post a second baby. Reading
// whether a baby already exists server-side lets the page resume at step 2.
export const load: PageServerLoad = () => {
	return { hasBaby: listBabies(getDb()).length > 0 };
};
