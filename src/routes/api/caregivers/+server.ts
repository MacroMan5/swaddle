import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { createCaregiver, listCaregivers } from '$lib/server/settings/repo';

export const GET: RequestHandler = handler({
	run: ({ db }) => json({ caregivers: listCaregivers(db) })
});

const createCaregiverSchema = z.object({
	name: z.string().min(1).max(100),
	color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
});

export const POST: RequestHandler = handler({
	schema: createCaregiverSchema,
	invalidMessage: 'invalid caregiver',
	run: ({ db, body }) => json(createCaregiver(db, body), { status: 201 })
});
