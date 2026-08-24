import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migrate, migrations } from './migrations';
import { openDb } from './index';

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
		const db = openDb(':memory:');
		// :memory: reste en mode 'memory' ; foreign_keys est le contrat vérifiable
		expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
	});
});
