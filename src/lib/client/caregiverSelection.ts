// Reconciles the device's locally stored caregiver selection against the
// authoritative caregiver list (issue #48): a stale id — deleted here or on
// another device — must never be sent in a new event/timer write, and the
// device should fall back to the first remaining caregiver rather than a
// generic validation failure.
import type { CaregiverDTO } from './types';

const STORAGE_KEY = 'swaddle.caregiverId';

/**
 * Pure reconciliation rule: keep `storedId` if it still names a caregiver in
 * `caregivers`, otherwise adopt the first authoritative caregiver, or `null`
 * once none remain.
 */
export function reconcileCaregiverId(
	storedId: string | null,
	caregivers: CaregiverDTO[]
): string | null {
	if (storedId !== null && caregivers.some((c) => c.id === storedId)) return storedId;
	return caregivers[0]?.id ?? null;
}

export function getStoredCaregiverId(): string | null {
	return typeof window === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
}

export function setStoredCaregiverId(id: string | null): void {
	if (typeof window === 'undefined') return;
	if (id === null) localStorage.removeItem(STORAGE_KEY);
	else localStorage.setItem(STORAGE_KEY, id);
}

/**
 * Reads the stored caregiver id, reconciles it against `caregivers`, persists
 * the corrected value, and returns it — the single call site bootstrap (Today,
 * Settings) and post-deletion paths use so the stale-id repair happens the
 * same way everywhere.
 */
export function reconcileStoredCaregiverId(caregivers: CaregiverDTO[]): string | null {
	const reconciled = reconcileCaregiverId(getStoredCaregiverId(), caregivers);
	setStoredCaregiverId(reconciled);
	return reconciled;
}
