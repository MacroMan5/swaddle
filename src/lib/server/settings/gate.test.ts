import { describe, expect, it } from 'vitest';
import { hashPin, sessionToken } from './auth';
import { gateDecision } from './gate';

describe('gateDecision', () => {
	it('is always ok for /api/auth/pin, /api/health, /_app/ and /favicon', () => {
		for (const pathname of ['/api/auth/pin', '/api/health', '/_app/immutable/x.js', '/favicon.ico']) {
			expect(
				gateDecision({ pathname, setupComplete: false, pinHash: 'x', sessionCookie: undefined })
			).toBe('ok');
		}
	});

	it('redirects to /setup when setup is incomplete', () => {
		expect(
			gateDecision({ pathname: '/', setupComplete: false, pinHash: null, sessionCookie: undefined })
		).toBe('to-setup');
	});

	it('setup incomplete but path=/setup → ok', () => {
		expect(
			gateDecision({ pathname: '/setup', setupComplete: false, pinHash: null, sessionCookie: undefined })
		).toBe('ok');
	});

	it('setup incomplete allows the wizard API routes', () => {
		for (const pathname of ['/api/babies', '/api/caregivers', '/api/household']) {
			expect(
				gateDecision({ pathname, setupComplete: false, pinHash: null, sessionCookie: undefined })
			).toBe('ok');
		}
	});

	it('redirects to /pin when a pin is set and the session is invalid', () => {
		expect(
			gateDecision({ pathname: '/', setupComplete: true, pinHash: 'stored', sessionCookie: undefined })
		).toBe('to-pin');
	});

	it('pin ok via cookie → ok', () => {
		const hash = hashPin('1234');
		const cookie = sessionToken(hash);
		expect(
			gateDecision({ pathname: '/', setupComplete: true, pinHash: hash, sessionCookie: cookie })
		).toBe('ok');
	});

	it('api without a valid session → to-pin', () => {
		expect(
			gateDecision({
				pathname: '/api/events',
				setupComplete: true,
				pinHash: 'stored',
				sessionCookie: undefined
			})
		).toBe('to-pin');
	});

	it('path=/pin itself is never redirected again', () => {
		expect(
			gateDecision({ pathname: '/pin', setupComplete: true, pinHash: 'stored', sessionCookie: undefined })
		).toBe('ok');
	});

	it('no pin set → ok everywhere once setup is complete', () => {
		expect(
			gateDecision({ pathname: '/', setupComplete: true, pinHash: null, sessionCookie: undefined })
		).toBe('ok');
	});
});
