import { MAX_BODY_LABEL } from '$lib/limits';

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
	| 'pin_required'
	| 'payload_too_large';

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
		case 'payload_too_large':
			return `Fichier trop volumineux (${MAX_BODY_LABEL} maximum).`;
		default:
			return 'Une erreur est survenue.';
	}
}

export function errorMessage(value: ApiErrorBody): string {
	return userMessage(value?.error?.code, value?.error?.issues);
}

/**
 * Domain issues raised by hand (src/lib/server/events/types.ts, outside zod)
 * already carry a precise `code`; one French sentence per code covers them.
 * `segment_still_open` is reused for two different meanings (only the last
 * segment may stay open vs. a finished session can't keep one open) and is
 * disambiguated by path in `fieldMessage` below.
 */
const DOMAIN_CODE_MESSAGES: Record<string, string> = {
	too_far_in_future: 'La date ne peut pas être à plus de 5 minutes dans le futur.',
	end_before_start: 'La fin doit être après le début.',
	segments_required: 'Ajoutez au moins un segment de tétée.',
	segment_out_of_bounds: 'Le segment doit rester dans les limites de la séance.',
	segment_overlap: 'Les segments doivent être dans l’ordre, sans chevauchement.',
	volume_required: 'Le volume est requis pour terminer le tirage.',
	ended_at_required: 'La fin est requise.',
	ended_at_forbidden: 'Cet évènement ne prend pas d’heure de fin.',
	invalid_json: 'Requête invalide.'
};

/**
 * Zod `.refine`/`.superRefine` issues (code 'custom') surface only their
 * English message, so they're recognised and translated by that exact text.
 */
const CUSTOM_ISSUE_MESSAGES: Record<string, string> = {
	'a diaper needs at least pee or poo': 'Cochez au moins pipi ou caca.',
	'birthdate cannot be in the future': 'La date de naissance ne peut pas être dans le futur.',
	'birthdate is not a valid calendar date': 'Cette date n’existe pas.'
};

/**
 * Structural zod issues (too_small, too_big, invalid_type, invalid_format,
 * invalid_value) are field-shaped, not code-shaped: the same code means
 * different things on `volumeMl` vs `name`. Keyed by the last meaningful path
 * segment (see `lastPathSegment`).
 */
const FIELD_MESSAGES: Record<
	string,
	Partial<Record<'too_small' | 'too_big' | 'invalid_type' | 'invalid_format' | 'invalid_value', string>>
> = {
	volumeMl: {
		too_small: 'Le volume doit être d’au moins 1 ml.',
		too_big: 'Le volume ne peut pas dépasser 1000 ml.',
		invalid_type: 'Le volume doit être un nombre.'
	},
	name: {
		too_small: 'Le nom est requis.',
		too_big: 'Le nom est trop long (100 caractères maximum).',
		invalid_type: 'Le nom doit être du texte.'
	},
	color: { invalid_format: 'La couleur doit être au format #RRGGBB.' },
	pin: { invalid_format: 'Le code doit contenir de 4 à 8 chiffres.' },
	birthdate: { invalid_format: 'Date de naissance invalide (AAAA-MM-JJ).' },
	timezone: {
		too_small: 'Le fuseau horaire est requis.',
		invalid_type: 'Le fuseau horaire doit être du texte.'
	},
	note: { too_big: 'La note est trop longue (1000 caractères maximum).' },
	startedAt: { invalid_format: 'Date ou heure de début invalide.' },
	endedAt: { invalid_format: 'Date ou heure de fin invalide.' },
	babyId: { too_small: 'Le bébé est requis.' },
	caregiverId: { too_small: 'L’aidant est requis.' },
	side: { invalid_value: 'Choisissez un côté valide.' },
	milkType: { invalid_value: 'Choisissez un type de lait valide.' }
};

/** "details.segments.2.startedAt" / "segments.2.startedAt" -> "startedAt". */
function lastPathSegment(path: string): string {
	const parts = path.split('.').filter((p) => p !== '' && p !== 'details' && !/^\d+$/.test(p));
	return parts[parts.length - 1] ?? '';
}

/**
 * Translates one validation issue (server field-error contract, always
 * English) into a short French label for inline display next to the field.
 * The API contract itself stays English — this is presentation only. Never
 * falls through to the raw `message`.
 */
export function fieldMessage(issue: { path: string; code: string; message: string }): string {
	const { path, code, message } = issue;

	if (code === 'segment_still_open')
		return path.endsWith('endedAt')
			? 'Seul le dernier segment peut rester en cours.'
			: 'Terminez tous les segments avant de clore la séance.';

	if (code in DOMAIN_CODE_MESSAGES) return DOMAIN_CODE_MESSAGES[code];

	if (code === 'custom') return CUSTOM_ISSUE_MESSAGES[message] ?? 'Champ invalide.';

	const field = FIELD_MESSAGES[lastPathSegment(path)];
	const structural = field?.[code as keyof (typeof FIELD_MESSAGES)[string]];
	if (structural) return structural;

	return 'Champ invalide.';
}
