import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '$lib/server/db';
import { EVENT_COLUMNS } from '$lib/server/events/eventRow';
import { RepoError } from '$lib/server/events/repo';
import { createApiToken, listApiTokens, verifyBearer } from './apiTokens';
import { createBaby, createCaregiver, getPinHash, listCaregivers, setPinHash } from './repo';
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

	it('preserves deletedAt on a soft-deleted event (the restore is verbatim)', () => {
		const a = seed();
		const b = openDb(':memory:');
		importJson(b, exportJson(a));

		const restored = exportJson(b).events.find((e) => e.id === 'e3');
		expect(restored?.deletedAt).toBe('2026-08-01T02:05:00.000Z');
		expect(restored?.createdAt).toBe('2026-08-01T02:00:00.000Z');
		expect(restored?.updatedAt).toBe('2026-08-01T02:05:00.000Z');
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

	it('rejects a non-ISO startedAt, nothing written', () => {
		const a = seed();
		const exported = exportJson(a);
		exported.events[0] = { ...exported.events[0], startedAt: 'not-a-date' };

		const b = seed();
		const before = exportJson(b);
		expect(() => importJson(b, exported)).toThrow(RepoError);
		expect(exportJson(b).events).toEqual(before.events);
	});

	it('rejects a non-ISO endedAt, nothing written', () => {
		const a = seed();
		const exported = exportJson(a);
		exported.events[1] = { ...exported.events[1], endedAt: 'not-a-date' };

		const b = seed();
		const before = exportJson(b);
		expect(() => importJson(b, exported)).toThrow(RepoError);
		expect(exportJson(b).events).toEqual(before.events);
	});

	it('rejects an endedAt before startedAt, nothing written', () => {
		const a = seed();
		const exported = exportJson(a);
		// e2 (nursing) starts at 01:00; back-date its end before that.
		exported.events[1] = { ...exported.events[1], endedAt: '2026-08-01T00:00:00.000Z' };

		const b = seed();
		const before = exportJson(b);
		expect(() => importJson(b, exported)).toThrow(RepoError);
		expect(exportJson(b).events).toEqual(before.events);
	});

	it('rejects a startedAt more than 5 minutes in the future, nothing written', () => {
		const a = seed();
		const exported = exportJson(a);
		exported.events[0] = {
			...exported.events[0],
			startedAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
		};

		const b = seed();
		const before = exportJson(b);
		expect(() => importJson(b, exported)).toThrow(RepoError);
		expect(exportJson(b).events).toEqual(before.events);
	});

	it('rejects a point event (bottle/diaper) carrying an endedAt, nothing written', () => {
		const a = seed();
		const exported = exportJson(a);
		// e1 is a diaper (point) event; point events must keep endedAt null.
		exported.events[0] = { ...exported.events[0], endedAt: '2026-08-01T00:10:00.000Z' };

		const b = seed();
		const before = exportJson(b);
		expect(() => importJson(b, exported)).toThrow(RepoError);
		expect(exportJson(b).events).toEqual(before.events);
	});

	it('rejects two undeleted active timers of the same type for the same baby, nothing written', () => {
		const a = seed();
		const exported = exportJson(a);
		// Turn e2 (nursing, completed) into a second active nursing session for
		// the same baby as a fresh id — FR-013 allows at most one.
		exported.events[1] = {
			...exported.events[1],
			id: 'e2-active',
			endedAt: null,
			details: { segments: [{ side: 'left', startedAt: exported.events[1].startedAt, endedAt: null }] }
		};
		exported.events.push({
			...exported.events[1],
			id: 'e2-active-dup'
		});

		const b = seed();
		const before = exportJson(b);
		expect(() => importJson(b, exported)).toThrow(RepoError);
		expect(exportJson(b).events).toEqual(before.events);
	});

	it('allows a soft-deleted active-shaped timer alongside a real active one (no false conflict)', () => {
		const a = seed();
		const exported = exportJson(a);
		exported.events[1] = {
			...exported.events[1],
			id: 'e2-active',
			endedAt: null,
			deletedAt: null,
			details: { segments: [{ side: 'left', startedAt: exported.events[1].startedAt, endedAt: null }] }
		};
		exported.events.push({
			...exported.events[1],
			id: 'e2-active-deleted',
			deletedAt: '2026-08-01T03:00:00.000Z'
		});

		const b = openDb(':memory:');
		expect(() => importJson(b, exported)).not.toThrow();
	});
});

// #97: the voice vocabulary is household configuration and travels with the
// data; API tokens are per-device secrets and deliberately do not.
describe('quick words and api tokens in the transfer (issue #97)', () => {
	it('exports the vocabulary and restores a customised one', () => {
		const a = seed();
		a.prepare('INSERT INTO quick_word (id, word, intent) VALUES (?, ?, ?)').run(
			'qw-nini',
			'nini',
			'{"action":"nursing"}'
		);
		a.prepare("DELETE FROM quick_word WHERE word = 'sieste'").run();

		const exported = exportJson(a);
		expect(exported.quickWords).toContainEqual({
			id: 'qw-nini',
			word: 'nini',
			intent: { action: 'nursing' }
		});
		expect(exported.quickWords.map((w) => w.word)).not.toContain('sieste');

		const b = openDb(':memory:');
		importJson(b, exported);
		expect(exportJson(b).quickWords).toEqual(exported.quickWords);
	});

	it.each([
		[null, 'no intent at all'],
		[{ action: 'burp' }, 'an unknown action'],
		[{ action: 'diaper' }, 'a diaper without its kind'],
		['sleep', 'a bare string']
	])('refuses a restored word whose intent is %j — %s', (intent, _why) => {
		const a = seed();
		const exported = exportJson(a);
		const before = exported.quickWords;
		exported.quickWords = [...before, { id: 'qw-broken', word: 'casse', intent }];

		// Refused on the way in: a word the vocabulary cannot read would break
		// every later read of it — the settings page included.
		expect(() => importJson(a, exported)).toThrow(RepoError);
		expect(exportJson(a).quickWords).toEqual(before);
	});

	it.each([
		['!!!', 'punctuation alone'],
		['gros caca', 'two words'],
		['petit-dodo', 'a hyphenated pair'],
		// Stored unnormalised it would never match a dictation, and would shadow
		// the entry it collides with once normalised.
		['Néné', 'a word that is not in its stored form']
	])('refuses a restored word %j — %s', (word, _why) => {
		const a = seed();
		const exported = exportJson(a);
		const before = exported.quickWords;
		exported.quickWords = [...before, { id: 'qw-broken', word, intent: { action: 'sleep' } }];

		expect(() => importJson(a, exported)).toThrow(RepoError);
		expect(exportJson(a).quickWords).toEqual(before);
	});

	it('leaves the vocabulary untouched when restoring a legacy export that has none', () => {
		const b = seed();
		const before = exportJson(b).quickWords;
		expect(before.length).toBeGreaterThan(0);

		const { quickWords: _dropped, ...legacy } = exportJson(seed());
		void _dropped;
		expect(() => importJson(b, legacy)).not.toThrow();
		expect(exportJson(b).quickWords).toEqual(before);
	});

	it('never exports an api token, and a restore leaves the household s tokens alone', () => {
		const a = seed();
		const { plaintext, token } = createApiToken(a, { name: 'iPhone' });
		const exported = exportJson(a);
		expect(JSON.stringify(exported)).not.toContain(plaintext);
		expect(JSON.stringify(exported)).not.toContain(token.id);
		expect('apiTokens' in exported).toBe(false);

		// Restoring into the same database must not cut the family's devices off.
		importJson(a, exported);
		expect(verifyBearer(a, `Bearer ${plaintext}`)?.tokenId).toBe(token.id);
	});

	it('keeps a token attached to its caregiver when the restore recreates that caregiver', () => {
		const a = seed();
		const caregiverId = listCaregivers(a)[0].id;
		const { plaintext, token } = createApiToken(a, { name: 'iPhone', caregiverId });
		expect(token.caregiverId).toBe(caregiverId);

		// The restore wipes and recreates the caregiver table; ON DELETE SET NULL
		// would otherwise silently detach every token on the way through, even
		// though the payload puts the very same caregiver ids back.
		importJson(a, exportJson(a));

		expect(listApiTokens(a)[0].caregiverId).toBe(caregiverId);
		expect(verifyBearer(a, `Bearer ${plaintext}`)).toEqual({
			tokenId: token.id,
			caregiverId
		});
	});

	it('leaves a token detached when the restored payload no longer holds its caregiver', () => {
		const a = seed();
		const caregiverId = listCaregivers(a)[0].id;
		const { plaintext, token } = createApiToken(a, { name: 'iPhone', caregiverId });

		// A payload from a household that has since dropped that caregiver (and
		// the events referencing it): the link has nothing to point at any more.
		const exported = exportJson(a);
		exported.caregivers = [];
		exported.events = [];

		importJson(a, exported);

		expect(listApiTokens(a)[0].caregiverId).toBeNull();
		// The token itself keeps working — it just attributes to nobody.
		expect(verifyBearer(a, `Bearer ${plaintext}`)).toEqual({
			tokenId: token.id,
			caregiverId: null
		});
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

	it('has one column per event column (the camelCase header stays a literal contract)', () => {
		const db = seed();
		const header = exportCsv(db).split('\r\n')[0];
		expect(header.split(',')).toHaveLength(EVENT_COLUMNS.length);
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
