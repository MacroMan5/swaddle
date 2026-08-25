import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError, getJson } from './api';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('ApiError', () => {
	it('keeps the raw English server message and derives a French userMessage', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: { code: 'timer_conflict', message: 'an active timer already exists' }
						}),
						{ status: 409, headers: { 'content-type': 'application/json' } }
					)
			)
		);

		await expect(getJson('/api/timers/nursing/start')).rejects.toMatchObject({
			message: 'an active timer already exists',
			userMessage: 'Une séance est déjà en cours.'
		});
	});

	it('is an instance of ApiError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: { code: 'not_found', message: 'gone' } }), {
						status: 404,
						headers: { 'content-type': 'application/json' }
					})
			)
		);

		try {
			await getJson('/api/babies/x');
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(ApiError);
			expect((e as ApiError).userMessage).toBe('Introuvable.');
		}
	});
});
