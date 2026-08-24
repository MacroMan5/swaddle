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
