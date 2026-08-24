import { describe, expect, it } from 'vitest';
import {
	createPinThrottle,
	hashPin,
	isValidSession,
	sessionCookieOptions,
	sessionToken,
	verifyPin
} from './auth';

describe('hashPin / verifyPin', () => {
	it('round-trips', () => {
		const hash = hashPin('1234');
		expect(verifyPin('1234', hash)).toBe(true);
	});

	it('rejects a wrong pin', () => {
		const hash = hashPin('1234');
		expect(verifyPin('9999', hash)).toBe(false);
	});

	it('salts so two hashes of the same pin differ', () => {
		expect(hashPin('1234')).not.toBe(hashPin('1234'));
	});
});

describe('sessions', () => {
	it('produces a valid token for the current pin hash', () => {
		const hash = hashPin('1234');
		const token = sessionToken(hash);
		expect(isValidSession(token, hash)).toBe(true);
	});

	it('invalidates the old token after the pin hash changes', () => {
		const hash = hashPin('1234');
		const token = sessionToken(hash);
		const newHash = hashPin('5678');
		expect(isValidSession(token, newHash)).toBe(false);
	});

	it('is open (valid) when no pin is set', () => {
		expect(isValidSession(undefined, null)).toBe(true);
	});

	it('rejects a missing cookie when a pin is set', () => {
		const hash = hashPin('1234');
		expect(isValidSession(undefined, hash)).toBe(false);
	});
});

describe('sessionCookieOptions', () => {
	it('is not secure over plain HTTP (LAN deployment)', () => {
		expect(sessionCookieOptions(new URL('http://192.168.1.10:3000/api/auth/pin')).secure).toBe(
			false
		);
	});

	it('is secure over HTTPS', () => {
		expect(sessionCookieOptions(new URL('https://swaddle.example/api/auth/pin')).secure).toBe(true);
	});

	it('is always httpOnly, path-scoped and long-lived', () => {
		const opts = sessionCookieOptions(new URL('http://localhost/'));
		expect(opts.httpOnly).toBe(true);
		expect(opts.sameSite).toBe('lax');
		expect(opts.path).toBe('/');
		expect(opts.maxAge).toBeGreaterThan(0);
	});
});

describe('createPinThrottle', () => {
	it('allows attempts until the failure threshold is reached', () => {
		const throttle = createPinThrottle(5, 30_000);
		let now = 0;
		for (let i = 0; i < 4; i++) {
			expect(throttle.isLocked(now)).toBe(false);
			throttle.recordFailure(now);
		}
		// 4 failures recorded: still under the threshold of 5.
		expect(throttle.isLocked(now)).toBe(false);
	});

	it('locks out after the 5th consecutive failure, for the configured window', () => {
		const throttle = createPinThrottle(5, 30_000);
		let now = 1_000;
		for (let i = 0; i < 5; i++) throttle.recordFailure(now);
		expect(throttle.isLocked(now)).toBe(true);
		expect(throttle.isLocked(now + 29_999)).toBe(true);
		expect(throttle.isLocked(now + 30_000)).toBe(false);
	});

	it('a success resets the failure count', () => {
		const throttle = createPinThrottle(5, 30_000);
		const now = 0;
		for (let i = 0; i < 4; i++) throttle.recordFailure(now);
		throttle.recordSuccess();
		for (let i = 0; i < 4; i++) throttle.recordFailure(now);
		expect(throttle.isLocked(now)).toBe(false); // only 4 failures since the reset
	});
});
