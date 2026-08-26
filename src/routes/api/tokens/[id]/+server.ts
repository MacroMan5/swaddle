import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { revokeApiToken } from '$lib/server/settings/apiTokens';

// Revocation, not deletion: the row stays listed so a parent can see the
// device was cut off, and its hash stays taken forever.
export const DELETE: RequestHandler = handler({
	run: ({ db, params }) => {
		revokeApiToken(db, params.id);
		return new Response(null, { status: 204 });
	}
});
