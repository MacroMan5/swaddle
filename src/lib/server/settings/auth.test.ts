import { describe, expect, it } from 'vitest';
import { hashPin, isValidSession, sessionToken, verifyPin } from './auth';

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
