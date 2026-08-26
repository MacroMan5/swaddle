import { describe, expect, it } from 'vitest';
import { hashPin, sessionToken } from './auth';
import { gateDecision } from './gate';

describe('gateDecision', () => {
	it('is always ok for /api/health, /_app/ and /favicon.ico (exact/prefix allowlist)', () => {
		for (const pathname of ['/api/health', '/_app/immutable/x.js', '/favicon.ico']) {
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

	// Full matrix: setup incomplete AND a pin is set (no valid session). The PIN
	// gate must win over the setup gate here, or two things break: an API
	// caller with no session could reach setup-wizard-exempt routes without a
	// pin, and pages would redirect-loop (/setup -> /pin -> /setup -> ...)
	// because neither gate alone recognizes the other's exempt path.
	describe('setupComplete: false AND a pin is set (no valid session)', () => {
		const base = { setupComplete: false, pinHash: 'stored', sessionCookie: undefined } as const;

		it('/setup → to-pin (must unlock before continuing setup)', () => {
			expect(gateDecision({ ...base, pathname: '/setup' })).toBe('to-pin');
		});

		it('/pin → ok (no redirect loop: the unlock page always loads)', () => {
			expect(gateDecision({ ...base, pathname: '/pin' })).toBe('ok');
		});

		it('/api/events → to-pin (401 pin_required, not silently allowed)', () => {
			expect(gateDecision({ ...base, pathname: '/api/events' })).toBe('to-pin');
		});

		it('/api/stream → to-pin', () => {
			expect(gateDecision({ ...base, pathname: '/api/stream' })).toBe('to-pin');
		});

		it('/api/auth/pin → ok (must be reachable to attempt unlock)', () => {
			expect(gateDecision({ ...base, pathname: '/api/auth/pin' })).toBe('ok');
		});
	});

	// ADR 0004: a valid Bearer stands in for a PIN session, but only on /api/*.
	// The hook does the verifying; the decision only takes the boolean.
	describe('bearer authentication (issue #97)', () => {
		const locked = { setupComplete: true, pinHash: 'stored', sessionCookie: undefined } as const;

		it('a valid bearer unlocks the API without a cookie', () => {
			for (const pathname of ['/api/events', '/api/timers/nursing', '/api/stream']) {
				expect(gateDecision({ ...locked, pathname, hasBearerAuth: true })).toBe('ok');
			}
		});

		it('a valid bearer never unlocks a page', () => {
			for (const pathname of ['/', '/history', '/settings']) {
				expect(gateDecision({ ...locked, pathname, hasBearerAuth: true })).toBe('to-pin');
			}
		});

		it('an invalid, unknown or revoked bearer is just no bearer → to-pin', () => {
			// The hook turns all three into hasBearerAuth: false.
			expect(gateDecision({ ...locked, pathname: '/api/events', hasBearerAuth: false })).toBe('to-pin');
			expect(gateDecision({ ...locked, pathname: '/api/events' })).toBe('to-pin');
		});

		it('token management stays session-only: a bearer cannot mint or revoke tokens', () => {
			for (const pathname of ['/api/tokens', '/api/tokens/abc']) {
				expect(gateDecision({ ...locked, pathname, hasBearerAuth: true })).toBe('to-pin');
			}
		});

		it('a bearer still cannot skip the setup gate on a page', () => {
			expect(
				gateDecision({
					pathname: '/',
					setupComplete: false,
					pinHash: null,
					sessionCookie: undefined,
					hasBearerAuth: true
				})
			).toBe('to-setup');
		});
	});
});
