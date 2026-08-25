import { describe, it, expect } from 'vitest';
import { errorMessage, userMessage, type ApiErrorCode } from './errors';

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
		pin_required: 'Session expirée. Entrez le code.'
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
