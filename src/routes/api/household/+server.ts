import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { getHousehold, updateHousehold } from '$lib/server/settings/repo';

export const GET: RequestHandler = handler({
	run: ({ db }) => json(getHousehold(db))
});

const patchHouseholdSchema = z.strictObject({
	volumeUnit: z.enum(['ml', 'oz']).optional(),
	theme: z.enum(['light', 'dark', 'auto']).optional()
});

export const PATCH: RequestHandler = handler({
	schema: patchHouseholdSchema,
	invalidMessage: 'invalid patch',
	run: ({ db, body }) => json(updateHousehold(db, body))
});
