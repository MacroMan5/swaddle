import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	getStoredCaregiverId,
	reconcileCaregiverId,
	reconcileStoredCaregiverId,
	setStoredCaregiverId
} from './caregiverSelection';
import type { CaregiverDTO } from './types';

const cgA: CaregiverDTO = { id: 'cg-a', name: 'A', color: '#111111' };
const cgB: CaregiverDTO = { id: 'cg-b', name: 'B', color: '#222222' };

describe('reconcileCaregiverId (pure rule)', () => {
	it('keeps the stored id when it still names a caregiver', () => {
		expect(reconcileCaregiverId('cg-b', [cgA, cgB])).toBe('cg-b');
	});

	it('falls back to the first caregiver when the stored id is unknown (deleted elsewhere)', () => {
		expect(reconcileCaregiverId('cg-gone', [cgA, cgB])).toBe('cg-a');
	});

	it('falls back to the first caregiver when nothing is stored yet', () => {
		expect(reconcileCaregiverId(null, [cgA, cgB])).toBe('cg-a');
	});

	it('clears the selection once no caregiver remains', () => {
		expect(reconcileCaregiverId('cg-gone', [])).toBeNull();
		expect(reconcileCaregiverId(null, [])).toBeNull();
	});
});

describe('storage access outside a browser', () => {
	it('getStoredCaregiverId/setStoredCaregiverId are no-ops without window', () => {
		expect(getStoredCaregiverId()).toBeNull();
		expect(() => setStoredCaregiverId('cg-a')).not.toThrow();
	});
});

describe('reconcileStoredCaregiverId (browser round trip)', () => {
	class FakeStorage {
		#store = new Map<string, string>();
		getItem(key: string): string | null {
			return this.#store.get(key) ?? null;
		}
		setItem(key: string, value: string): void {
			this.#store.set(key, value);
		}
		removeItem(key: string): void {
			this.#store.delete(key);
		}
	}

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('adopts the first caregiver and persists it when the stored id is stale', () => {
		const storage = new FakeStorage();
		storage.setItem('swaddle.caregiverId', 'cg-gone');
		vi.stubGlobal('window', {});
		vi.stubGlobal('localStorage', storage);

		expect(reconcileStoredCaregiverId([cgA, cgB])).toBe('cg-a');
		expect(storage.getItem('swaddle.caregiverId')).toBe('cg-a');
	});

	it('removes the stale key once no caregiver remains', () => {
		const storage = new FakeStorage();
		storage.setItem('swaddle.caregiverId', 'cg-gone');
		vi.stubGlobal('window', {});
		vi.stubGlobal('localStorage', storage);

		expect(reconcileStoredCaregiverId([])).toBeNull();
		expect(storage.getItem('swaddle.caregiverId')).toBeNull();
	});

	it('leaves a still-valid stored id untouched', () => {
		const storage = new FakeStorage();
		storage.setItem('swaddle.caregiverId', 'cg-b');
		vi.stubGlobal('window', {});
		vi.stubGlobal('localStorage', storage);

		expect(reconcileStoredCaregiverId([cgA, cgB])).toBe('cg-b');
		expect(storage.getItem('swaddle.caregiverId')).toBe('cg-b');
	});
});
