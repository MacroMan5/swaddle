import { json } from '@sveltejs/kit';
import { RepoError } from './events/repo';
import type { Issue, Result } from './events/types';

export function apiError(status: number, code: string, message: string, issues?: Issue[]): Response {
	return json({ error: { code, message, ...(issues ? { issues } : {}) } }, { status });
}

/** Reads a JSON body, turning a malformed one into a validation issue. */
export async function readJson(request: Request): Promise<Result<unknown>> {
	try {
		return { ok: true, value: await request.json() };
	} catch {
		return {
			ok: false,
			issues: [{ path: '', code: 'invalid_json', message: 'request body is not valid JSON' }]
		};
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
	if (e instanceof RepoError) return apiError(repoStatus[e.code], e.code, e.message, e.issues);
	const constraintCode = sqliteConstraintCode(e);
	if (constraintCode === 'SQLITE_CONSTRAINT_FOREIGNKEY')
		return apiError(400, 'validation_failed', 'unknown babyId or caregiverId');
	if (constraintCode !== undefined)
		return apiError(400, 'validation_failed', 'the request violates a database constraint');
	throw e;
}
