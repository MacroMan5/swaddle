import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, readJson } from '$lib/server/api';
import { createCaregiver, listCaregivers } from '$lib/server/settings/repo';

export const GET: RequestHandler = () => {
	return json({ caregivers: listCaregivers(getDb()) });
};

const createCaregiverSchema = z.object({
	name: z.string().min(1).max(100),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
});

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	if (!body.ok) return apiError(400, 'validation_failed', 'invalid caregiver', body.issues);

	const parsed = createCaregiverSchema.safeParse(body.value);
	if (!parsed.success)
		return apiError(
			400,
			'validation_failed',
			'invalid caregiver',
			parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }))
		);

	const caregiver = createCaregiver(getDb(), parsed.data);
	return json(caregiver, { status: 201 });
};
