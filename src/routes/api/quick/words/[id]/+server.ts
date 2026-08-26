import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { deleteQuickWord } from '$lib/server/quick/words';

// A hard delete: a word is configuration, not history — removing « sieste »
// only means nobody says it any more.
export const DELETE: RequestHandler = handler({
	run: ({ db, params }) => {
		deleteQuickWord(db, params.id);
		return new Response(null, { status: 204 });
	}
});
