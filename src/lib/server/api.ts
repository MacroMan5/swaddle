import { json } from '@sveltejs/kit';
import { MAX_BODY_BYTES } from '$lib/limits';
import { RepoError } from './events/repo';
import type { Issue, Result } from './events/types';

export function apiError(status: number, code: string, message: string, issues?: Issue[]): Response {
	return json({ error: { code, message, ...(issues ? { issues } : {}) } }, { status });
}

/** The 413 envelope: its own code, so the UI can say « fichier trop volumineux ». */
export function payloadTooLarge(): Response {
	return apiError(413, 'payload_too_large', `request body exceeds ${MAX_BODY_BYTES} bytes`);
}

/** Raised by `readJson` for a body that turned out to be over the bound. */
export class PayloadTooLargeError extends Error {
	readonly status = 413;
	constructor() {
		super(`request body exceeds ${MAX_BODY_BYTES} bytes`);
	}
}

/**
 * adapter-node aborts the body stream with a 413 `SvelteKitError` as soon as a
 * request passes `BODY_SIZE_LIMIT`. That rejection surfaces on the first read
 * of the body — which is indistinguishable from malformed JSON unless the
 * status is looked at (issue #45). Matches `PayloadTooLargeError` too: both
 * carry `status: 413`.
 */
export function isPayloadTooLarge(e: unknown): boolean {
	return typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 413;
}

const invalidJson: Result<never> = {
	ok: false,
	issues: [{ path: '', code: 'invalid_json', message: 'request body is not valid JSON' }]
};

/**
 * Reads a JSON body, turning a malformed one into a validation issue. An
 * oversized body is *not* malformed: it throws instead, so the caller answers
 * with the 413 envelope rather than `validation_failed` — `handleRepoError`
 * maps it for the routes that call this from inside `run` (the pin route).
 */
export async function readJson(request: Request): Promise<Result<unknown>> {
	let text: string;
	try {
		text = await request.text();
	} catch (e) {
		if (isPayloadTooLarge(e)) throw e;
		return invalidJson;
	}

	// A chunked request declares no content-length, so the header check in the
	// route skeleton cannot see it; and no adapter limit applies under
	// `vite dev`, nor if an operator raised `BODY_SIZE_LIMIT`. What was actually
	// read is therefore measured here — before parsing it, which is the
	// expensive half — so the bound holds on every path.
	if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new PayloadTooLargeError();

	try {
		return { ok: true, value: JSON.parse(text) as unknown };
	} catch {
		return invalidJson;
	}
}

const repoStatus: Record<RepoError['code'], number> = {
	not_found: 404,
	no_active_timer: 404,
	invalid_state: 409,
	timer_conflict: 409,
	validation_failed: 400,
	in_use: 409
};

/**
 * better-sqlite3 raises one of these when a write violates a table
 * constraint (an unknown baby_id/caregiver_id, a duplicate primary key, …).
 * Application code should catch such cases earlier with a precise RepoError,
 * but this is the defense-in-depth fallback so a gap never surfaces as a raw
 * 500 instead of a 400 envelope.
 */
function sqliteConstraintCode(e: unknown): string | undefined {
	if (
		typeof e === 'object' &&
		e !== null &&
		'code' in e &&
		typeof (e as { code: unknown }).code === 'string' &&
		(e as { code: string }).code.startsWith('SQLITE_CONSTRAINT')
	)
		return (e as { code: string }).code;
	return undefined;
}

export function handleRepoError(e: unknown): Response {
	// Routes that read their body inside `run` (the pin route reads it after the
	// throttle) throw past the skeleton's own size handling: the last catch has
	// to know the 413 too, or an oversized body would surface as a 500.
	if (isPayloadTooLarge(e)) return payloadTooLarge();
	if (e instanceof RepoError) return apiError(repoStatus[e.code], e.code, e.message, e.issues);
	const constraintCode = sqliteConstraintCode(e);
	if (constraintCode === 'SQLITE_CONSTRAINT_FOREIGNKEY')
		return apiError(400, 'validation_failed', 'unknown babyId or caregiverId');
	// The schema holds exactly one unique index: the partial one enforcing a
	// single active timer per baby and type (FR-013, migration v2). Duplicate
	// primary keys surface as SQLITE_CONSTRAINT_PRIMARYKEY, not _UNIQUE, so this
	// mapping cannot catch anything else. The application guards answer first in
	// practice; this is the net behind them.
	if (constraintCode === 'SQLITE_CONSTRAINT_UNIQUE')
		return apiError(409, 'timer_conflict', 'an active timer already exists for this baby and type');
	if (constraintCode !== undefined)
		return apiError(400, 'validation_failed', 'the request violates a database constraint');
	throw e;
}
