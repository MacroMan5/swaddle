import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, readJson } from '$lib/server/api';
import { getHousehold, updateHousehold } from '$lib/server/settings/repo';

export const GET: RequestHandler = () => {
	return json(getHousehold(getDb()));
};

const patchHouseholdSchema = z.strictObject({
	volumeUnit: z.enum(['ml', 'oz']).optional(),
	theme: z.enum(['light', 'dark', 'auto']).optional()
});

export const PATCH: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	if (!body.ok) return apiError(400, 'validation_failed', 'invalid patch', body.issues);

	const parsed = patchHouseholdSchema.safeParse(body.value);
	if (!parsed.success)
		return apiError(
			400,
			'validation_failed',
			'invalid patch',
			parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }))
		);

	return json(updateHousehold(getDb(), parsed.data));
};
