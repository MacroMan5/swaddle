import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const SESSION_COOKIE = 'swaddle_session';
export const PIN_SCHEMA = z.string().regex(/^\d{4,8}$/);

const SESSION_MESSAGE = 'swaddle-session-v1';

/** `salt:hash` hex, scrypt-derived with a random 16-byte salt. */
export function hashPin(pin: string): string {
	const salt = randomBytes(16);
	const derived = scryptSync(pin, salt, 32);
	return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
	const [saltHex, hashHex] = stored.split(':');
	if (!saltHex || !hashHex) return false;
	const salt = Buffer.from(saltHex, 'hex');
	const expected = Buffer.from(hashHex, 'hex');
	const derived = scryptSync(pin, salt, expected.length);
	if (derived.length !== expected.length) return false;
	return timingSafeEqual(derived, expected);
}

export function sessionToken(pinHash: string): string {
	return createHmac('sha256', pinHash).update(SESSION_MESSAGE).digest('hex');
}

export function isValidSession(cookie: string | undefined, pinHash: string | null): boolean {
	if (pinHash === null) return true; // no pin set: the app is open
	if (!cookie) return false;
	const expected = Buffer.from(sessionToken(pinHash), 'hex');
	const actual = Buffer.from(cookie, 'hex');
	if (actual.length !== expected.length) return false;
	return timingSafeEqual(actual, expected);
}

const SESSION_MAX_AGE_S = 60 * 60 * 24 * 365; // 1 year (DEC-003: long-lived per-device session)

/**
 * Centralized session cookie attributes. `secure` follows the request's own
 * protocol rather than defaulting to true (SvelteKit's own default): the real
 * deployment is plain HTTP on a LAN IP, where a `secure` cookie would never be
 * sent back by the browser and PIN unlock would silently break.
 */
export function sessionCookieOptions(url: URL): {
	httpOnly: true;
	sameSite: 'lax';
	path: '/';
	maxAge: number;
	secure: boolean;
} {
	return {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		maxAge: SESSION_MAX_AGE_S,
		secure: url.protocol === 'https:'
	};
}

/**
 * In-memory brute-force throttle for PIN attempts (single process — a LAN app
 * has no load balancer to make module-level state unsafe). After
 * `maxAttempts` consecutive failures, further attempts are locked out for
 * `lockoutMs`; a success resets the counter. `now` is injected so tests don't
 * depend on real timers.
 */
export function createPinThrottle(maxAttempts = 5, lockoutMs = 30_000) {
	let failures = 0;
	let lockedUntil = 0;
	return {
		isLocked(now: number): boolean {
			return now < lockedUntil;
		},
		recordFailure(now: number): void {
			failures += 1;
			if (failures >= maxAttempts) lockedUntil = now + lockoutMs;
		},
		recordSuccess(): void {
			failures = 0;
			lockedUntil = 0;
		}
	};
}

/** Singleton used by the /api/auth/pin route. */
export const pinThrottle = createPinThrottle();
