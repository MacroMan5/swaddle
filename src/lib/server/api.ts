import { json } from '@sveltejs/kit';
import { RepoError } from './events/repo';
import type { Issue } from './events/types';

export function apiError(status: number, code: string, message: string, issues?: Issue[]): Response {
	return json({ error: { code, message, ...(issues ? { issues } : {}) } }, { status });
}

const repoStatus: Record<RepoError['code'], number> = {
	not_found: 404,
	no_active_timer: 404,
	invalid_state: 409,
	timer_conflict: 409
};

export function handleRepoError(e: unknown): Response {
	if (e instanceof RepoError) return apiError(repoStatus[e.code], e.code, e.message);
	throw e;
}
