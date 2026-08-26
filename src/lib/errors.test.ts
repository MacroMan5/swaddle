import { describe, it, expect } from 'vitest';
import { errorMessage, fieldMessage, userMessage, type ApiErrorCode } from './errors';

describe('userMessage', () => {
	const messages: Record<ApiErrorCode, string> = {
		validation_failed: 'Certains champs sont invalides.',
		not_found: 'Introuvable.',
		no_active_timer: 'Aucune séance en cours.',
		unknown_timer_type: 'Type de minuteur inconnu.',
		invalid_state: 'Action impossible dans l’état actuel.',
		timer_conflict: 'Une séance est déjà en cours.',
		in_use: 'Impossible : des activités y sont liées.',
		forbidden: 'Code actuel incorrect.',
		too_many_attempts: 'Trop de tentatives. Réessayez dans quelques instants.',
		pin_required: 'Session expirée. Entrez le code.',
		payload_too_large: 'Fichier trop volumineux (10 Mo maximum).',
		duplicate_word: 'Ce mot est déjà utilisé.'
	};

	for (const [code, expected] of Object.entries(messages)) {
		it(`maps ${code} to its own French message`, () => {
			const message = userMessage(code);
			expect(message).toBe(expected);
			expect(message).not.toBe(userMessage('unknown_code'));
		});
	}

	it('falls back to the generic message for an unknown code', () => {
		expect(userMessage('some_unmapped_code')).toBe('Une erreur est survenue.');
	});

	it('falls back to the generic message for an undefined code', () => {
		expect(userMessage(undefined)).toBe('Une erreur est survenue.');
	});

	it('lists field paths for validation_failed with issues', () => {
		expect(userMessage('validation_failed', [{ path: 'volumeMl' }, { path: 'startedAt' }])).toBe(
			'Certains champs sont invalides : volumeMl, startedAt'
		);
	});

	it('uses the generic validation message when there are no issues', () => {
		expect(userMessage('validation_failed')).toBe('Certains champs sont invalides.');
		expect(userMessage('validation_failed', [])).toBe('Certains champs sont invalides.');
	});
});

describe('errorMessage (compat wrapper)', () => {
	it('returns the generic message for null/empty bodies', () => {
		expect(errorMessage(null)).toBe('Une erreur est survenue.');
		expect(errorMessage({})).toBe('Une erreur est survenue.');
	});

	it('maps a body carrying a known code', () => {
		expect(errorMessage({ error: { code: 'in_use' } })).toBe(
			'Impossible : des activités y sont liées.'
		);
	});

	it('forwards issues for validation_failed', () => {
		expect(
			errorMessage({ error: { code: 'validation_failed', issues: [{ path: 'name', message: 'x' }] } })
		).toBe('Certains champs sont invalides : name');
	});
});

describe('fieldMessage', () => {
	// Hand-rolled domain codes (src/lib/server/events/types.ts) — one French
	// sentence per code, independent of path.
	const domainCodes: Record<string, string> = {
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

	for (const [code, expected] of Object.entries(domainCodes)) {
		it(`maps domain code ${code} to its French sentence`, () => {
			expect(fieldMessage({ path: 'startedAt', code, message: 'irrelevant english text' })).toBe(
				expected
			);
		});
	}

	it('disambiguates segment_still_open by path (only-the-last-may-be-open)', () => {
		expect(
			fieldMessage({
				path: 'details.segments.1.endedAt',
				code: 'segment_still_open',
				message: 'only the last segment may be open'
			})
		).toBe('Seul le dernier segment peut rester en cours.');
	});

	it('disambiguates segment_still_open by path (session cannot keep an open segment)', () => {
		expect(
			fieldMessage({
				path: 'details.segments',
				code: 'segment_still_open',
				message: 'a completed nursing session cannot keep an open segment'
			})
		).toBe('Terminez tous les segments avant de clore la séance.');
	});

	it('maps the diaper custom refine by its exact message', () => {
		expect(
			fieldMessage({
				path: '',
				code: 'custom',
				message: 'a diaper needs at least pee or poo'
			})
		).toBe('Cochez au moins pipi ou caca.');
	});

	it('maps the birthdate custom refine by its exact message', () => {
		expect(
			fieldMessage({
				path: 'birthdate',
				code: 'custom',
				message: 'birthdate cannot be in the future'
			})
		).toBe('La date de naissance ne peut pas être dans le futur.');
	});

	it('maps the impossible-calendar-date custom refine by its exact message', () => {
		expect(
			fieldMessage({
				path: 'birthdate',
				code: 'custom',
				message: 'birthdate is not a valid calendar date'
			})
		).toBe('Cette date n’existe pas.');
	});

	it('falls back for an unrecognised custom message', () => {
		expect(fieldMessage({ path: 'x', code: 'custom', message: 'something else entirely' })).toBe(
			'Champ invalide.'
		);
	});

	// Structural zod issues: same code, different field -> different sentence.
	const structuralCases: { path: string; code: string; expected: string }[] = [
		{ path: 'volumeMl', code: 'too_small', expected: 'Le volume doit être d’au moins 1 ml.' },
		{ path: 'details.volumeMl', code: 'too_big', expected: 'Le volume ne peut pas dépasser 1000 ml.' },
		{ path: 'volumeMl', code: 'invalid_type', expected: 'Le volume doit être un nombre.' },
		{ path: 'name', code: 'too_small', expected: 'Le nom est requis.' },
		{ path: 'name', code: 'too_big', expected: 'Le nom est trop long (100 caractères maximum).' },
		{ path: 'name', code: 'invalid_type', expected: 'Le nom doit être du texte.' },
		{ path: 'color', code: 'invalid_format', expected: 'La couleur doit être au format #RRGGBB.' },
		{ path: 'pin', code: 'invalid_format', expected: 'Le code doit contenir de 4 à 8 chiffres.' },
		{
			path: 'birthdate',
			code: 'invalid_format',
			expected: 'Date de naissance invalide (AAAA-MM-JJ).'
		},
		{ path: 'timezone', code: 'too_small', expected: 'Le fuseau horaire est requis.' },
		{
			path: 'timezone',
			code: 'invalid_type',
			expected: 'Le fuseau horaire doit être du texte.'
		},
		{ path: 'note', code: 'too_big', expected: 'La note est trop longue (1000 caractères maximum).' },
		{ path: 'startedAt', code: 'invalid_format', expected: 'Date ou heure de début invalide.' },
		{
			path: 'details.segments.0.startedAt',
			code: 'invalid_format',
			expected: 'Date ou heure de début invalide.'
		},
		{ path: 'endedAt', code: 'invalid_format', expected: 'Date ou heure de fin invalide.' },
		{ path: 'babyId', code: 'too_small', expected: 'Le bébé est requis.' },
		{ path: 'caregiverId', code: 'too_small', expected: 'L’aidant est requis.' },
		{ path: 'details.segments.0.side', code: 'invalid_value', expected: 'Choisissez un côté valide.' },
		{ path: 'milkType', code: 'invalid_value', expected: 'Choisissez un type de lait valide.' }
	];

	for (const { path, code, expected } of structuralCases) {
		it(`maps ${code} on ${path} to its field-specific sentence`, () => {
			expect(fieldMessage({ path, code, message: 'irrelevant english text' })).toBe(expected);
		});
	}

	it('falls back to the generic message for an unknown field/code pairing', () => {
		expect(fieldMessage({ path: 'someWeirdField', code: 'too_small', message: 'x' })).toBe(
			'Champ invalide.'
		);
	});

	it('falls back to the generic message for a completely unknown code', () => {
		expect(fieldMessage({ path: 'volumeMl', code: 'not_multiple_of', message: 'x' })).toBe(
			'Champ invalide.'
		);
	});

	// #44: the server always speaks canonical millilitres; the copy quotes the
	// household's unit.
	it('quotes the volume bounds in ounces when the household is on oz', () => {
		expect(fieldMessage({ path: 'volumeMl', code: 'too_small', message: 'x' }, 'oz')).toBe(
			'Le volume doit être d’au moins 0,1 oz.'
		);
		expect(fieldMessage({ path: 'details.volumeMl', code: 'too_big', message: 'x' }, 'oz')).toBe(
			'Le volume ne peut pas dépasser 33,8 oz.'
		);
		expect(fieldMessage({ path: 'volumeMl', code: 'invalid_type', message: 'x' }, 'oz')).toBe(
			'Le volume doit être un nombre.'
		);
	});

	it('keeps millilitres for every other field, whatever the unit', () => {
		expect(fieldMessage({ path: 'name', code: 'too_small', message: 'x' }, 'oz')).toBe(
			'Le nom est requis.'
		);
	});

	it('never leaks the raw English message', () => {
		const issue = { path: 'volumeMl', code: 'too_big', message: 'Too big: expected number to be <=1000' };
		expect(fieldMessage(issue)).not.toContain('Too big');
		expect(fieldMessage(issue)).not.toBe(issue.message);
	});
});
