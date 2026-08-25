import { json } from '@sveltejs/kit';
import { handler } from '$lib/server/http';
import { isSetupComplete } from '$lib/server/setup';

export const GET = handler({
	run: ({ db }) => json({ status: 'ok', setupComplete: isSetupComplete(db) })
});
