import { describe, expect, it } from 'vitest';
import { openDb } from '$lib/server/db';
import { RepoError } from '$lib/server/events/repo';
import {
	createBaby,
	createCaregiver,
	deleteCaregiver,
	ensureHousehold,
	getHousehold,
	getPinHash,
	listCaregivers,
	setPinHash,
	updateBaby,
	updateCaregiver,
	updateHousehold
} from './repo';
import { listBabies } from '$lib/server/events/repo';

describe('household', () => {
	it('is lazily created with defaults', () => {
		const db = openDb(':memory:');
		ensureHousehold(db);
		expect(getHousehold(db)).toEqual({ volumeUnit: 'ml', theme: 'auto', pinEnabled: false });
	});

	it('getHousehold also lazily creates the row', () => {
		const db = openDb(':memory:');
		expect(getHousehold(db)).toEqual({ volumeUnit: 'ml', theme: 'auto', pinEnabled: false });
	});

	it('update unit and theme persists', () => {
		const db = openDb(':memory:');
		ensureHousehold(db);
		const updated = updateHousehold(db, { volumeUnit: 'oz', theme: 'dark' });
		expect(updated).toEqual({ volumeUnit: 'oz', theme: 'dark', pinEnabled: false });
		expect(getHousehold(db)).toEqual({ volumeUnit: 'oz', theme: 'dark', pinEnabled: false });
	});

	it('pinEnabled reflects pin_hash', () => {
		const db = openDb(':memory:');
		ensureHousehold(db);
		expect(getPinHash(db)).toBeNull();
		setPinHash(db, 'salt:hash');
		expect(getPinHash(db)).toBe('salt:hash');
		expect(getHousehold(db).pinEnabled).toBe(true);
		setPinHash(db, null);
		expect(getHousehold(db).pinEnabled).toBe(false);
	});
});

describe('baby', () => {
	it('is created and listed via listBabies', () => {
		const db = openDb(':memory:');
		const baby = createBaby(db, { name: 'Léa', birthdate: '2026-08-01', timezone: 'America/Toronto' });
		expect(baby.name).toBe('Léa');
		expect(listBabies(db)).toEqual([baby]);
	});

	it('#46: corrects name and birthdate, leaving id and timezone unchanged', () => {
		const db = openDb(':memory:');
		const baby = createBaby(db, { name: 'Léa', birthdate: '2026-08-01', timezone: 'America/Toronto' });
		const corrected = updateBaby(db, baby.id, { name: 'Léa-Rose', birthdate: '2026-07-28' });
		expect(corrected).toEqual({
			id: baby.id,
			name: 'Léa-Rose',
			birthdate: '2026-07-28',
			timezone: 'America/Toronto'
		});
		expect(listBabies(db)).toEqual([corrected]);
	});

	it('#46: a partial patch keeps the field left out', () => {
		const db = openDb(':memory:');
		const baby = createBaby(db, { name: 'Léa', birthdate: '2026-08-01', timezone: 'America/Toronto' });
		const corrected = updateBaby(db, baby.id, { name: 'Léa-Rose' });
		expect(corrected.name).toBe('Léa-Rose');
		expect(corrected.birthdate).toBe('2026-08-01');
	});

	it('#46: throws not_found for an unknown baby', () => {
		const db = openDb(':memory:');
		expect(() => updateBaby(db, 'nope', { name: 'x' })).toThrow(RepoError);
	});
});

describe('caregiver', () => {
	it('creates, lists, updates and deletes', () => {
		const db = openDb(':memory:');
		const cg = createCaregiver(db, { name: 'Papa', color: '#0284C7' });
		expect(listCaregivers(db)).toEqual([cg]);
		const renamed = updateCaregiver(db, cg.id, { name: 'Papou' });
		expect(renamed.name).toBe('Papou');
		expect(renamed.color).toBe('#0284C7');
		deleteCaregiver(db, cg.id);
		expect(listCaregivers(db)).toEqual([]);
	});

	it('throws not_found on updating/deleting a missing caregiver', () => {
		const db = openDb(':memory:');
		expect(() => updateCaregiver(db, 'nope', { name: 'x' })).toThrow(RepoError);
		expect(() => deleteCaregiver(db, 'nope')).toThrow(RepoError);
	});

	it('refuses to delete a caregiver referenced by an event', () => {
		const db = openDb(':memory:');
		const baby = createBaby(db, { name: 'Léa', birthdate: '2026-08-01', timezone: 'America/Toronto' });
		const cg = createCaregiver(db, { name: 'Papa', color: '#0284C7' });
		db.prepare(
			`INSERT INTO event (id, baby_id, caregiver_id, type, started_at, ended_at, note, details, created_at, updated_at)
			 VALUES ('e1', ?, ?, 'diaper', '2026-08-01T00:00:00.000Z', NULL, NULL, '{"pee":true,"poo":false}', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`
		).run(baby.id, cg.id);
		expect(() => deleteCaregiver(db, cg.id)).toThrow(RepoError);
		try {
			deleteCaregiver(db, cg.id);
		} catch (e) {
			expect((e as RepoError).code).toBe('in_use');
		}
	});
});
