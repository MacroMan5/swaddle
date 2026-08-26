import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { createApiToken, listApiTokens } from '$lib/server/settings/apiTokens';

export const GET: RequestHandler = handler({
	run: ({ db }) => json({ tokens: listApiTokens(db) })
});

const createTokenSchema = z.object({
	name: z.string().min(1).max(100),
	caregiverId: z.string().min(1).nullable().optional()
});

export const POST: RequestHandler = handler({
	schema: createTokenSchema,
	invalidMessage: 'invalid token',
	// The only response that ever carries the plaintext (ADR 0004): it is never
	// stored, so it can never be shown again.
	run: ({ db, body }) => json(createApiToken(db, body), { status: 201 })
});
