import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { listBabies } from '$lib/server/events/repo';
import { createBaby } from '$lib/server/settings/repo';

export const GET: RequestHandler = handler({
	run: ({ db }) => json({ babies: listBabies(db) })
});

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

export const POST: RequestHandler = handler({
	schema: createBabySchema,
	invalidMessage: 'invalid baby',
	run: ({ db, body }) => {
		const timezone = body.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
		const baby = createBaby(db, { ...body, timezone });
		return json(baby, { status: 201 });
	}
});
