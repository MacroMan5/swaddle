import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '$lib/server/db';
import { RepoError } from '$lib/server/events/repo';
import { createBaby, createCaregiver, getPinHash, setPinHash } from './repo';
import { exportCsv, exportJson, importJson, snapshotTo } from './transfer';

function seed() {
	const db = openDb(':memory:');
	const baby = createBaby(db, { name: 'Léa', birthdate: '2026-08-01', timezone: 'America/Toronto' });
	const cg = createCaregiver(db, { name: 'Papa', color: '#0284C7' });
	db.prepare(
		`INSERT INTO event (id, baby_id, caregiver_id, type, started_at, ended_at, note, details, created_at, updated_at, deleted_at)
		 VALUES (?, ?, ?, 'diaper', '2026-08-01T00:00:00.000Z', NULL, NULL, '{"pee":true,"poo":false}', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', NULL)`
	).run('e1', baby.id, cg.id);
	db.prepare(
		`INSERT INTO event (id, baby_id, caregiver_id, type, started_at, ended_at, note, details, created_at, updated_at, deleted_at)
		 VALUES (?, ?, ?, 'nursing', '2026-08-01T01:00:00.000Z', '2026-08-01T01:20:00.000Z', 'a,"b"' || char(10) || 'c', '{"segments":[{"side":"left","startedAt":"2026-08-01T01:00:00.000Z","endedAt":"2026-08-01T01:20:00.000Z"}]}', '2026-08-01T01:00:00.000Z', '2026-08-01T01:20:00.000Z', NULL)`
	).run('e2', baby.id, cg.id);
	db.prepare(
		`INSERT INTO event (id, baby_id, caregiver_id, type, started_at, ended_at, note, details, created_at, updated_at, deleted_at)
		 VALUES (?, ?, ?, 'bottle', '2026-08-01T02:00:00.000Z', NULL, NULL, '{"milkType":"formula","volumeMl":90}', '2026-08-01T02:00:00.000Z', '2026-08-01T02:05:00.000Z', '2026-08-01T02:05:00.000Z')`
	).run('e3', baby.id, cg.id);
	return db;
}

describe('exportJson / importJson round-trip (AC-007)', () => {
	it('reproduces the exported data exactly (minus exportedAt)', () => {
		const a = seed();
		const exported = exportJson(a);
		expect(exported.events).toHaveLength(3);

		const b = openDb(':memory:');
		const result = importJson(b, exported);
		expect(result).toEqual({ babies: 1, caregivers: 1, events: 3 });

		const reExported = exportJson(b);
		const { exportedAt: _a, ...restA } = exported;
		const { exportedAt: _b, ...restB } = reExported;
		void _a;
		void _b;
		expect(restB).toEqual(restA);
	});

	it('rejects garbage and leaves existing rows untouched', () => {
		const b = seed();
		const { exportedAt: _before, ...before } = exportJson(b);
		void _before;
		expect(() => importJson(b, { nonsense: true })).toThrow(RepoError);
		const { exportedAt: _after, ...after } = exportJson(b);
		void _after;
		expect(after).toEqual(before);
	});

	it('preserves the current pin hash across a restore (the export never carries it)', () => {
		const a = seed();
		const exported = exportJson(a);

		const b = seed();
		setPinHash(b, 'salt:hash');
		importJson(b, exported);
		expect(getPinHash(b)).toBe('salt:hash');
	});

	it('rejects an event referencing an unknown babyId, nothing written', () => {
		const a = seed();
		const exported = exportJson(a);
		exported.events[0].babyId = 'no-such-baby';

		const b = seed();
		const before = exportJson(b);
		expect(() => importJson(b, exported)).toThrow(RepoError);
		expect(exportJson(b).events).toEqual(before.events);
	});

	it('rejects an event referencing an unknown caregiverId, nothing written', () => {
		const a = seed();
		const exported = exportJson(a);
		exported.events[0].caregiverId = 'no-such-caregiver';

		const b = seed();
		const before = exportJson(b);
		expect(() => importJson(b, exported)).toThrow(RepoError);
		expect(exportJson(b).events).toEqual(before.events);
	});

	it('rejects a duplicate event id within the payload, nothing written', () => {
		const a = seed();
		const exported = exportJson(a);
		exported.events[1] = { ...exported.events[1], id: exported.events[0].id };

		const b = seed();
		const before = exportJson(b);
		expect(() => importJson(b, exported)).toThrow(RepoError);
		expect(exportJson(b).events).toEqual(before.events);
	});

	it('rejects an event whose details do not match its type, nothing written', () => {
		const a = seed();
		const exported = exportJson(a);
		// A nursing session needs at least one segment.
		exported.events[1] = { ...exported.events[1], details: {} };

		const b = seed();
		const before = exportJson(b);
		expect(() => importJson(b, exported)).toThrow(RepoError);
		expect(exportJson(b).events).toEqual(before.events);
	});
});

describe('exportCsv', () => {
	it('has a header and quotes a note containing a comma, quote and newline', () => {
		const db = seed();
		const csv = exportCsv(db);
		const lines = csv.trim().split('\r\n');
		expect(lines[0]).toBe(
			'id,babyId,caregiverId,type,startedAt,endedAt,note,details,createdAt,updatedAt,deletedAt'
		);
		expect(csv).toContain('"a,""b""\nc"');
	});

	it('joins records with CRLF (strict RFC 4180)', () => {
		const db = seed();
		const csv = exportCsv(db);
		// Splitting on the record separator must yield exactly one line per
		// event plus the header — including the event whose note legitimately
		// contains a literal (non-separator) embedded LF inside its quoting.
		expect(csv.split('\r\n')).toHaveLength(1 /* header */ + 3 /* events */ + 1 /* trailing */);
		expect(csv.endsWith('\r\n')).toBe(true);
	});

	it('quotes a field containing only a bare CR', () => {
		const db = openDb(':memory:');
		const baby = createBaby(db, { name: 'Léa', birthdate: '2026-08-01', timezone: 'America/Toronto' });
		const cg = createCaregiver(db, { name: 'Papa', color: '#0284C7' });
		db.prepare(
			`INSERT INTO event (id, baby_id, caregiver_id, type, started_at, ended_at, note, details, created_at, updated_at, deleted_at)
			 VALUES ('e1', ?, ?, 'diaper', '2026-08-01T00:00:00.000Z', NULL, 'a' || char(13) || 'b', '{"pee":true,"poo":false}', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', NULL)`
		).run(baby.id, cg.id);
		const csv = exportCsv(db);
		expect(csv).toContain('"a\rb"');
	});
});

describe('snapshotTo', () => {
	let dir: string;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it('writes a reopenable sqlite file with the same event count', () => {
		const db = seed();
		dir = mkdtempSync(join(tmpdir(), 'swaddle-snapshot-'));
		const dest = join(dir, 'nested', 'backup.sqlite');
		snapshotTo(db, dest);
		expect(existsSync(dest)).toBe(true);
		const reopened = openDb(dest);
		const count = reopened.prepare('SELECT COUNT(*) AS n FROM event').get() as { n: number };
		expect(count.n).toBe(3);
		reopened.close();
	});
});
