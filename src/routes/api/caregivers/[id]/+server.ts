import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { deleteCaregiver, updateCaregiver } from '$lib/server/settings/repo';

const patchCaregiverSchema = z.strictObject({
	name: z.string().min(1).max(100).optional(),
	color: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/)
		.optional()
});

export const PATCH: RequestHandler = handler({
	schema: patchCaregiverSchema,
	invalidMessage: 'invalid patch',
	run: ({ db, body, params }) => json(updateCaregiver(db, params.id, body))
});

export const DELETE: RequestHandler = handler({
	run: ({ db, params }) => {
		deleteCaregiver(db, params.id);
		return new Response(null, { status: 204 });
	}
});
