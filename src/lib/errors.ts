export type ApiErrorBody = {
	error?: { code?: string; message?: string; issues?: { path: string; message: string }[] };
} | null;

/**
 * Every code emitted by the server: RepoError codes (src/lib/server/events/repo.ts)
 * plus the route-level codes documented in docs/api/events-api.md and
 * docs/api/settings-api.md.
 */
export type ApiErrorCode =
	| 'validation_failed'
	| 'not_found'
	| 'no_active_timer'
	| 'unknown_timer_type'
	| 'invalid_state'
	| 'timer_conflict'
	| 'in_use'
	| 'forbidden'
	| 'too_many_attempts'
	| 'pin_required';

/**
 * The stable API contract is error.code (docs/api/settings-api.md), never
 * the English error.message: map known codes to a French, field-appropriate
 * message instead of surfacing the raw server string.
 */
export function userMessage(code: string | undefined, issues?: { path: string }[]): string {
	switch (code as ApiErrorCode) {
		case 'in_use':
			return 'Impossible : des activités y sont liées.';
		case 'not_found':
			return 'Introuvable.';
		case 'forbidden':
			return 'Code actuel incorrect.';
		case 'too_many_attempts':
			return 'Trop de tentatives. Réessayez dans quelques instants.';
		case 'validation_failed':
			return issues?.length
				? 'Certains champs sont invalides : ' + issues.map((i) => i.path).join(', ')
				: 'Certains champs sont invalides.';
		case 'no_active_timer':
			return 'Aucune séance en cours.';
		case 'timer_conflict':
			return 'Une séance est déjà en cours.';
		case 'invalid_state':
			return 'Action impossible dans l’état actuel.';
		case 'unknown_timer_type':
			return 'Type de minuteur inconnu.';
		case 'pin_required':
			return 'Session expirée. Entrez le code.';
		default:
			return 'Une erreur est survenue.';
	}
}

export function errorMessage(value: ApiErrorBody): string {
	return userMessage(value?.error?.code, value?.error?.issues);
}
