import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { listBabies } from '$lib/server/events/repo';
import { createBaby } from '$lib/server/settings/repo';
import { createBabySchema } from '$lib/server/settings/babySchema';

export const GET: RequestHandler = handler({
	run: ({ db }) => json({ babies: listBabies(db) })
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
