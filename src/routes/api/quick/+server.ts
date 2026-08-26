import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { QuickError, quickErrorResponse } from '$lib/server/quick/errors';
import { performQuick } from '$lib/server/quick/perform';
import { quickIntentSchema } from '$lib/server/quick/types';

// A thin adapter over the quick module (ADR 0004): parse, delegate, answer.
// Home Assistant's `rest_command` and a future MCP tool call the same seam.
export const POST: RequestHandler = handler({
	schema: quickIntentSchema,
	invalidMessage: 'invalid quick intent',
	run: ({ db, body, locals }) => {
		try {
			// Attribution rides on the credential: a Bearer token linked to a
			// caregiver signs its writes; a PIN session names nobody.
			return json(performQuick(db, body, { caregiverId: locals.apiToken?.caregiverId ?? null }));
		} catch (e) {
			if (e instanceof QuickError) return quickErrorResponse(e);
			throw e; // RepoError and the rest are mapped by the skeleton
		}
	}
});
