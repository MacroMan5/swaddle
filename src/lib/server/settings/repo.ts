import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { BabyDTO } from '$lib/server/events/types';
import { RepoError } from '$lib/server/events/repo';

type DB = Database.Database;

export type HouseholdDTO = { volumeUnit: 'ml' | 'oz'; theme: 'light' | 'dark' | 'auto'; pinEnabled: boolean };
export type CaregiverDTO = { id: string; name: string; color: string };

const nowIso = () => new Date().toISOString();

type HouseholdRow = {
	pin_hash: string | null;
	volume_unit: 'ml' | 'oz';
	theme: 'light' | 'dark' | 'auto';
};

function rowToHousehold(row: HouseholdRow): HouseholdDTO {
	return { volumeUnit: row.volume_unit, theme: row.theme, pinEnabled: row.pin_hash !== null };
}

export function ensureHousehold(db: DB): void {
	db.prepare('INSERT OR IGNORE INTO household (id, created_at) VALUES (1, ?)').run(nowIso());
}

export function getHousehold(db: DB): HouseholdDTO {
	ensureHousehold(db);
	const row = db
		.prepare('SELECT pin_hash, volume_unit, theme FROM household WHERE id = 1')
		.get() as HouseholdRow;
	return rowToHousehold(row);
}

export function updateHousehold(
	db: DB,
	patch: { volumeUnit?: 'ml' | 'oz'; theme?: 'light' | 'dark' | 'auto' }
): HouseholdDTO {
	ensureHousehold(db);
	const current = getHousehold(db);
	db.prepare('UPDATE household SET volume_unit = ?, theme = ? WHERE id = 1').run(
		patch.volumeUnit ?? current.volumeUnit,
		patch.theme ?? current.theme
	);
	return getHousehold(db);
}

export function getPinHash(db: DB): string | null {
	ensureHousehold(db);
	const row = db.prepare('SELECT pin_hash FROM household WHERE id = 1').get() as {
		pin_hash: string | null;
	};
	return row.pin_hash;
}

export function setPinHash(db: DB, hash: string | null): void {
	ensureHousehold(db);
	db.prepare('UPDATE household SET pin_hash = ? WHERE id = 1').run(hash);
}

export function createBaby(
	db: DB,
	input: { name: string; birthdate: string; timezone: string }
): BabyDTO {
	const id = randomUUID();
	db.prepare(
		'INSERT INTO baby (id, name, birthdate, timezone, created_at) VALUES (?, ?, ?, ?, ?)'
	).run(id, input.name, input.birthdate, input.timezone, nowIso());
	return { id, name: input.name, birthdate: input.birthdate, timezone: input.timezone };
}

function requireBaby(db: DB, id: string): BabyDTO {
	const row = db.prepare('SELECT id, name, birthdate, timezone FROM baby WHERE id = ?').get(id) as
		| BabyDTO
		| undefined;
	if (!row) throw new RepoError('not_found', `no baby ${id}`);
	return row;
}

/** #46: lets a caregiver correct the name/birthdate captured at onboarding.
 * `id` and `timezone` — and every event referencing this baby — are untouched. */
export function updateBaby(db: DB, id: string, patch: { name?: string; birthdate?: string }): BabyDTO {
	const current = requireBaby(db, id);
	db.prepare('UPDATE baby SET name = ?, birthdate = ? WHERE id = ?').run(
		patch.name ?? current.name,
		patch.birthdate ?? current.birthdate,
		id
	);
	return requireBaby(db, id);
}

function rowToCaregiver(row: { id: string; name: string; color: string }): CaregiverDTO {
	return { id: row.id, name: row.name, color: row.color };
}

export function listCaregivers(db: DB): CaregiverDTO[] {
	return (
		db.prepare('SELECT id, name, color FROM caregiver ORDER BY created_at').all() as {
			id: string;
			name: string;
			color: string;
		}[]
	).map(rowToCaregiver);
}

export function createCaregiver(db: DB, input: { name: string; color: string }): CaregiverDTO {
	const id = randomUUID();
	db.prepare('INSERT INTO caregiver (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
		id,
		input.name,
		input.color,
		nowIso()
	);
	return { id, name: input.name, color: input.color };
}

function requireCaregiver(db: DB, id: string): CaregiverDTO {
	const row = db.prepare('SELECT id, name, color FROM caregiver WHERE id = ?').get(id) as
		| { id: string; name: string; color: string }
		| undefined;
	if (!row) throw new RepoError('not_found', `no caregiver ${id}`);
	return rowToCaregiver(row);
}

export function updateCaregiver(
	db: DB,
	id: string,
	patch: { name?: string; color?: string }
): CaregiverDTO {
	const current = requireCaregiver(db, id);
	db.prepare('UPDATE caregiver SET name = ?, color = ? WHERE id = ?').run(
		patch.name ?? current.name,
		patch.color ?? current.color,
		id
	);
	return requireCaregiver(db, id);
}

export function deleteCaregiver(db: DB, id: string): void {
	requireCaregiver(db, id);
	const referenced = db.prepare('SELECT 1 FROM event WHERE caregiver_id = ? LIMIT 1').get(id);
	if (referenced) throw new RepoError('in_use', `caregiver ${id} is referenced by an event`);
	db.prepare('DELETE FROM caregiver WHERE id = ?').run(id);
}
