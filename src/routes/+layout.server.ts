import type { LayoutServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { getHousehold } from '$lib/server/settings/repo';

/**
 * The household's volume unit (issue #44) reaches every screen through
 * `page.data`: it decorates values the whole app already holds in canonical
 * millilitres, so it belongs to the shell rather than to a store of its own.
 * Rendered with the page (no flash of the wrong unit) and refreshed by the
 * `invalidateAll()` the settings screen already performs on every change.
 */
export const load: LayoutServerLoad = () => ({
	volumeUnit: getHousehold(getDb()).volumeUnit
});
