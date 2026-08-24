export type ApiErrorBody = {
	error?: { code?: string; message?: string; issues?: { path: string; message: string }[] };
} | null;

/**
 * The stable API contract is error.code (docs/api/settings-api.md), never
 * the English error.message: map known codes to a French, field-appropriate
 * message instead of surfacing the raw server string.
 */
export function errorMessage(value: ApiErrorBody): string {
	switch (value?.error?.code) {
		case 'in_use':
			return 'Impossible : des activités y sont liées.';
		case 'not_found':
			return 'Introuvable.';
		case 'forbidden':
			return 'Code actuel incorrect.';
		case 'too_many_attempts':
			return 'Trop de tentatives. Réessayez dans quelques instants.';
		case 'validation_failed':
			return value?.error?.issues?.length
				? 'Certains champs sont invalides : ' + value.error.issues.map((i) => i.path).join(', ')
				: 'Certains champs sont invalides.';
		default:
			return 'Une erreur est survenue.';
	}
}
