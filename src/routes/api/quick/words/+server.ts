import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { handler } from '$lib/server/http';
import { QuickError, quickErrorResponse } from '$lib/server/quick/errors';
import { quickWordIntentSchema } from '$lib/server/quick/types';
import { addQuickWord, listQuickWords } from '$lib/server/quick/words';

// The vocabulary the `phrase` intent is resolved against (ADR 0004 § 3).
// Editing it is a settings action, but it lives under /api/quick because it is
// the same surface: what a shortcut can say.
export const GET: RequestHandler = handler({
	run: ({ db }) => json({ words: listQuickWords(db) })
});

const addWordSchema = z.object({
	// Normalised server-side, so the caller may send « Néné » as typed.
	word: z.string().min(1).max(50),
	intent: quickWordIntentSchema
});

export const POST: RequestHandler = handler({
	schema: addWordSchema,
	invalidMessage: 'invalid vocabulary word',
	run: ({ db, body }) => {
		try {
			return json(addQuickWord(db, body), { status: 201 });
		} catch (e) {
			if (e instanceof QuickError) return quickErrorResponse(e);
			throw e;
		}
	}
});
