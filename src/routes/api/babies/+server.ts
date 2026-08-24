import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { listBabies } from '$lib/server/events/repo';
import { apiError, readJson } from '$lib/server/api';
import { createBaby } from '$lib/server/settings/repo';

export const GET: RequestHandler = () => {
	return json({ babies: listBabies(getDb()) });
};

const createBabySchema = z.object({
	name: z.string().min(1).max(100),
	birthdate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.refine((d) => d <= new Date().toISOString().slice(0, 10), {
			message: 'birthdate cannot be in the future'
		}),
	timezone: z.string().min(1).optional()
});

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	if (!body.ok) return apiError(400, 'validation_failed', 'invalid baby', body.issues);

	const parsed = createBabySchema.safeParse(body.value);
	if (!parsed.success)
		return apiError(
			400,
			'validation_failed',
			'invalid baby',
			parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }))
		);

	const timezone = parsed.data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	const baby = createBaby(getDb(), { ...parsed.data, timezone });
	return json(baby, { status: 201 });
};
