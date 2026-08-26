import { json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api';

/**
 * The refusals this module owns, apart from the domain's own `RepoError`
 * (FR-017 validation above all), which the route skeleton already maps.
 *
 * They live here rather than next to `performQuick` so the vocabulary
 * repository can raise one without importing the module that imports it.
 */
export type QuickErrorCode =
	| 'ambiguous_baby'
	| 'duplicate_word'
	| 'unrecognized_phrase'
	| 'missing_volume';

const STATUS: Record<QuickErrorCode, number> = {
	ambiguous_baby: 409,
	duplicate_word: 409,
	// Well-formed request, understood vocabulary surface, nothing to do with it:
	// 422 rather than 400, which is reserved for a body the schema refused.
	unrecognized_phrase: 422,
	missing_volume: 422
};

export class QuickError extends Error {
	constructor(
		public code: QuickErrorCode,
		message: string,
		/** French sentence the assistant reads back, when the refusal has one. */
		public speech?: string
	) {
		super(message);
	}
}

/**
 * The error envelope of `docs/api/events-api.md`, plus the top-level `speech` a
 * voice client reads out loud: a Siri shortcut says the same field whether the
 * call worked or not, without inspecting the status.
 */
export function quickErrorResponse(e: QuickError): Response {
	const status = STATUS[e.code];
	if (e.speech === undefined) return apiError(status, e.code, e.message);
	return json({ error: { code: e.code, message: e.message }, speech: e.speech }, { status });
}
