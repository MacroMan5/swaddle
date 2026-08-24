import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../db';
import {
	createEvent,
	getEvent,
	listEvents,
	updateEvent,
	softDeleteEvent,
	restoreEvent,
	listBabies,
	RepoError
} from './repo';
import type { CreateEventInput } from './types';

let db: Database.Database;

function seed(db: Database.Database) {
	const now = new Date().toISOString();
	db.prepare(
		'INSERT INTO baby (id, name, birthdate, timezone, created_at) VALUES (?, ?, ?, ?, ?)'
	).run('baby-1', 'Testine', '2026-08-01', 'America/Toronto', now);
	db.prepare('INSERT INTO caregiver (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
		'cg-1',
		'Parent',
		'#4f8a8b',
		now
	);
}

const bottle = (over: Partial<CreateEventInput> = {}): CreateEventInput => ({
	babyId: 'baby-1',
	caregiverId: 'cg-1',
	type: 'bottle',
	startedAt: '2026-08-23T11:00:00.000Z',
	endedAt: null,
	note: null,
	details: { milkType: 'formula', volumeMl: 90 },
	...over
});

beforeEach(() => {
	db = openDb(':memory:');
	seed(db);
});

describe('event CRUD', () => {
	it('creates and reads back an event as camelCase DTO with parsed details', () => {
		const created = createEvent(db, bottle());
		expect(created.id).toBeTruthy();
		expect(created.babyId).toBe('baby-1');
		expect(created.details).toEqual({ milkType: 'formula', volumeMl: 90 });
		expect(created.deletedAt).toBeNull();
		expect(getEvent(db, created.id)).toEqual(created);
	});

	it('lists non-deleted events for a baby, startedAt DESC, from inclusive / to exclusive', () => {
		const a = createEvent(db, bottle({ startedAt: '2026-08-23T08:00:00.000Z' }));
		const b = createEvent(db, bottle({ startedAt: '2026-08-23T10:00:00.000Z' }));
		createEvent(db, bottle({ startedAt: '2026-08-24T10:00:00.000Z' }));
		const listed = listEvents(db, {
			babyId: 'baby-1',
			from: '2026-08-23T08:00:00.000Z',
			to: '2026-08-24T00:00:00.000Z'
		});
		expect(listed.map((e) => e.id)).toEqual([b.id, a.id]);
	});

	it('updates fields and bumps updatedAt', () => {
		const created = createEvent(db, bottle());
		const updated = updateEvent(db, created.id, { note: 'hungry night' });
		expect(updated.note).toBe('hungry night');
		expect(updated.updatedAt >= created.updatedAt).toBe(true);
	});

	it('soft-deletes (kept in DB, hidden from list) and restores', () => {
		const created = createEvent(db, bottle());
		const deleted = softDeleteEvent(db, created.id);
		expect(deleted.deletedAt).not.toBeNull();
		expect(listEvents(db, { babyId: 'baby-1' })).toHaveLength(0);
		expect(getEvent(db, created.id)?.deletedAt).not.toBeNull();
		const restored = restoreEvent(db, created.id);
		expect(restored.deletedAt).toBeNull();
		expect(listEvents(db, { babyId: 'baby-1' })).toHaveLength(1);
	});

	it('throws RepoError not_found on unknown ids', () => {
		expect(() => updateEvent(db, 'nope', { note: 'x' })).toThrowError(RepoError);
		expect(() => softDeleteEvent(db, 'nope')).toThrowError(RepoError);
		expect(() => restoreEvent(db, 'nope')).toThrowError(RepoError);
	});

	it('lists babies', () => {
		expect(listBabies(db)).toEqual([
			{ id: 'baby-1', name: 'Testine', birthdate: '2026-08-01', timezone: 'America/Toronto' }
		]);
	});
});
