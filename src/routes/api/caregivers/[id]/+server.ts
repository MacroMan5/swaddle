import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { apiError, handleRepoError, readJson } from '$lib/server/api';
import { deleteCaregiver, updateCaregiver } from '$lib/server/settings/repo';

const patchCaregiverSchema = z.strictObject({
	name: z.string().min(1).max(100).optional(),
	color: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/)
		.optional()
});

export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await readJson(request);
	if (!body.ok) return apiError(400, 'validation_failed', 'invalid patch', body.issues);

	const parsed = patchCaregiverSchema.safeParse(body.value);
	if (!parsed.success)
		return apiError(
			400,
			'validation_failed',
			'invalid patch',
			parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }))
		);

	try {
		const caregiver = updateCaregiver(getDb(), params.id, parsed.data);
		return json(caregiver);
	} catch (e) {
		return handleRepoError(e);
	}
};

export const DELETE: RequestHandler = ({ params }) => {
	try {
		deleteCaregiver(getDb(), params.id);
		return new Response(null, { status: 204 });
	} catch (e) {
		return handleRepoError(e);
	}
};
