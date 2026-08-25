import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, migrations } from './migrations';
import { openDb } from './index';

function insertEventSql(
	db: Database.Database,
	id: string,
	type: string,
	startedAt: string,
	details: string,
	deletedAt = 'NULL'
) {
	db.prepare(
		`INSERT INTO event (id, baby_id, type, started_at, details, created_at, updated_at, deleted_at)
		 VALUES (?, 'b1', ?, ?, ?, ?, ?, ${deletedAt})`
	).run(id, type, startedAt, details, startedAt, startedAt);
}

const insertSleep = (db: Database.Database, id: string, startedAt: string, deletedAt = 'NULL') =>
	insertEventSql(db, id, 'sleep', startedAt, '{}', deletedAt);

const insertBottle = (db: Database.Database, id: string, startedAt: string) =>
	insertEventSql(db, id, 'bottle', startedAt, '{"milkType":"formula","volumeMl":90}');

/** A database left at schema v1, holding data the v2 invariant forbids. */
function v1WithTwoActiveSleeps(): Database.Database {
	const db = new Database(':memory:');
	db.exec(migrations[0]);
	db.pragma('user_version = 1');
	db.prepare(
		"INSERT INTO baby (id, name, birthdate, timezone, created_at) VALUES ('b1', 'Léa', '2026-08-01', 'America/Toronto', '2026-08-23T00:00:00.000Z')"
	).run();
	insertSleep(db, 's1', '2026-08-23T01:00:00.000Z');
	insertSleep(db, 's2', '2026-08-23T02:00:00.000Z');
	return db;
}

describe('migrations', () => {
	it('applies all migrations on an empty db and sets user_version', () => {
		const db = new Database(':memory:');
		migrate(db);
		expect(db.pragma('user_version', { simple: true })).toBe(migrations.length);
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
			.all()
			.map((r: any) => r.name);
		expect(tables).toEqual(expect.arrayContaining(['baby', 'caregiver', 'event', 'household']));
	});

	it('is idempotent', () => {
		const db = new Database(':memory:');
		migrate(db);
		expect(() => migrate(db)).not.toThrow();
		expect(db.pragma('user_version', { simple: true })).toBe(migrations.length);
	});

	it('repairs duplicate active timers and enforces uniqueness afterwards (v2)', () => {
		const db = v1WithTwoActiveSleeps();

		migrate(db);

		expect(db.pragma('user_version', { simple: true })).toBe(migrations.length);
		const active = db
			.prepare(
				"SELECT id FROM event WHERE baby_id = 'b1' AND type = 'sleep' AND ended_at IS NULL AND deleted_at IS NULL"
			)
			.all() as { id: string }[];
		expect(active.map((r) => r.id)).toEqual(['s2']); // the most recently started one
		// Nothing is lost: the loser is soft-deleted, still there, still active-shaped.
		const loser = db.prepare("SELECT * FROM event WHERE id = 's1'").get() as {
			deleted_at: string | null;
			updated_at: string;
			ended_at: string | null;
		};
		expect(loser.deleted_at).not.toBeNull();
		expect(loser.updated_at).toBe(loser.deleted_at);
		expect(loser.ended_at).toBeNull(); // never fabricated

		// A second active timer of the same type is now impossible.
		expect(() => insertSleep(db, 's3', '2026-08-23T03:00:00.000Z')).toThrow(
			/SQLITE_CONSTRAINT_UNIQUE|UNIQUE constraint/
		);

		// …but the index must not touch point events, whose ended_at is null by design.
		expect(() => insertBottle(db, 'bo1', '2026-08-23T04:00:00.000Z')).not.toThrow();
		expect(() => insertBottle(db, 'bo2', '2026-08-23T05:00:00.000Z')).not.toThrow();

		// A soft-deleted active timer coexists with a live one of the same type.
		insertSleep(db, 's4', '2026-08-23T06:00:00.000Z', "'2026-08-23T06:00:00.000Z'");
		expect(
			db.prepare("SELECT COUNT(*) AS n FROM event WHERE type = 'sleep'").get()
		).toEqual({ n: 3 });

		// Replaying the migration is a no-op.
		expect(() => migrate(db)).not.toThrow();
		expect(db.pragma('user_version', { simple: true })).toBe(migrations.length);
	});

	it('enforces event type check constraint', () => {
		const db = new Database(':memory:');
		migrate(db);
		db.prepare(
			"INSERT INTO baby (id, name, birthdate, timezone, created_at) VALUES ('b1', 'Léa', '2026-08-01', 'America/Toronto', '2026-08-23T00:00:00.000Z')"
		).run();
		expect(() =>
			db
				.prepare(
					"INSERT INTO event (id, baby_id, type, started_at, details, created_at, updated_at) VALUES ('e1', 'b1', 'invalid', '2026-08-23T00:00:00.000Z', '{}', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z')"
				)
				.run()
		).toThrow();
	});
});

describe('openDb', () => {
	it('opens in WAL mode with foreign keys on', () => {
		// A real file is required: ':memory:' databases report journal_mode 'memory'
		const dir = mkdtempSync(join(tmpdir(), 'swaddle-db-'));
		const db = openDb(join(dir, 'test.db'));
		try {
			expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
			expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
		} finally {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
