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

/** better-sqlite3 raises this when baby_id or caregiver_id points nowhere. */
function isForeignKeyError(e: unknown): boolean {
	return (
		typeof e === 'object' &&
		e !== null &&
		'code' in e &&
		(e as { code: unknown }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
	);
}

export function handleRepoError(e: unknown): Response {
	if (e instanceof RepoError) return apiError(repoStatus[e.code], e.code, e.message, e.issues);
	if (isForeignKeyError(e))
		return apiError(400, 'validation_failed', 'unknown babyId or caregiverId');
	throw e;
}
