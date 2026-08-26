import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { updateBaby } from '$lib/server/settings/repo';
import { patchBabySchema } from '$lib/server/settings/babySchema';
import { publishBabyUpdated } from '$lib/server/events/broadcast';

export const PATCH: RequestHandler = handler({
	schema: patchBabySchema,
	invalidMessage: 'invalid patch',
	run: ({ db, body, params }) => {
		const baby = updateBaby(db, params.id, body);
		// So a Today screen already open on another device (or tab) picks up
		// the correction live instead of only on its next reload (#46).
		publishBabyUpdated(baby);
		return json(baby);
	}
});
