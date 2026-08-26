import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { updateBaby } from '$lib/server/settings/repo';
import { patchBabySchema } from '$lib/server/settings/babySchema';

export const PATCH: RequestHandler = handler({
	schema: patchBabySchema,
	invalidMessage: 'invalid patch',
	run: ({ db, body, params }) => json(updateBaby(db, params.id, body))
});
