import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../db';
import { subscribe, type Change } from '../events/broadcast';
import { createEvent, listActiveTimers } from '../events/repo';
import { QuickError, performQuick } from './perform';

let db: Database.Database;
let changes: Change[];
let unsubscribe: () => void;

function seed(db: Database.Database, babies: string[] = ['baby-1']) {
	const now = new Date().toISOString();
	for (const [i, id] of babies.entries())
		db.prepare(
			'INSERT INTO baby (id, name, birthdate, timezone, created_at) VALUES (?, ?, ?, ?, ?)'
		).run(id, `Bébé ${i + 1}`, '2026-08-01', 'America/Toronto', now);
	db.prepare('INSERT INTO caregiver (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
		'cg-1',
		'Parent',
		'#4f8a8b',
		now
	);
}

beforeEach(() => {
	db = openDb(':memory:');
	seed(db);
	changes = [];
	unsubscribe = subscribe((c) => changes.push(c));
});

afterEach(() => unsubscribe());

const ctx = { caregiverId: 'cg-1' };

describe('bottle', () => {
	it('logs a point event carrying the volume, and says so in French', () => {
		const result = performQuick(db, { action: 'bottle', volumeMl: 120 }, ctx);

		expect(result.did).toBe('logged');
		expect(result.speech).toBe('Biberon 120 millilitres enregistré');
		expect(result.event.type).toBe('bottle');
		expect(result.event.babyId).toBe('baby-1');
		// Point events carry no endedAt — the zero-duration convention the whole
		// domain uses (FR-017), not a start/end pair.
		expect(result.event.endedAt).toBeNull();
		expect(result.event.details).toEqual({ milkType: 'breast', volumeMl: 120 });
	});

	it('rejects a volume outside FR-017 bounds as validation_failed', () => {
		expect(() => performQuick(db, { action: 'bottle', volumeMl: 5000 }, ctx)).toThrow();
	});
});

describe('diaper', () => {
	it.each([
		['wet' as const, { pee: true, poo: false }, 'Couche pipi enregistrée'],
		['dirty' as const, { pee: false, poo: true }, 'Couche caca enregistrée'],
		['both' as const, { pee: true, poo: true }, 'Couche pipi et caca enregistrée']
	])('logs a %s diaper', (kind, details, speech) => {
		const result = performQuick(db, { action: 'diaper', kind }, ctx);

		expect(result.did).toBe('logged');
		expect(result.speech).toBe(speech);
		expect(result.event.type).toBe('diaper');
		expect(result.event.endedAt).toBeNull();
		expect(result.event.details).toEqual(details);
	});
});

describe('sleep toggle', () => {
	it('starts a timer when none runs, then stops the same one and announces its duration', () => {
		const started = performQuick(db, { action: 'sleep' }, ctx);
		expect(started.did).toBe('started');
		expect(started.speech).toBe('Dodo démarré');
		expect(started.event.endedAt).toBeNull();
		expect(listActiveTimers(db, 'baby-1')).toHaveLength(1);

		// Backdate the running timer so the stop has a duration to announce.
		db.prepare('UPDATE event SET started_at = ? WHERE id = ?').run(
			new Date(Date.now() - 40 * 60_000).toISOString(),
			started.event.id
		);

		const stopped = performQuick(db, { action: 'sleep' }, ctx);
		expect(stopped.did).toBe('stopped');
		expect(stopped.speech).toBe('Dodo terminé, 40 minutes');
		expect(stopped.event.id).toBe(started.event.id);
		expect(stopped.event.endedAt).not.toBeNull();
		expect(listActiveTimers(db, 'baby-1')).toHaveLength(0);
	});
});

describe('nursing toggle', () => {
	it('starts on the explicit side and stops on the second call', () => {
		const started = performQuick(db, { action: 'nursing', side: 'right' }, ctx);
		expect(started.did).toBe('started');
		expect(started.speech).toBe('Tétée côté droit démarrée');
		expect(started.event.details).toEqual({
			segments: [{ side: 'right', startedAt: started.event.startedAt, endedAt: null }]
		});

		db.prepare('UPDATE event SET started_at = ?, details = ? WHERE id = ?').run(
			new Date(Date.now() - 12 * 60_000).toISOString(),
			JSON.stringify({
				segments: [
					{ side: 'right', startedAt: new Date(Date.now() - 12 * 60_000).toISOString(), endedAt: null }
				]
			}),
			started.event.id
		);

		const stopped = performQuick(db, { action: 'nursing' }, ctx);
		expect(stopped.did).toBe('stopped');
		expect(stopped.speech).toBe('Tétée terminée, 12 minutes');
		expect(stopped.event.id).toBe(started.event.id);
	});

	it('defaults the side to the opposite of the last known one', () => {
		const past = new Date(Date.now() - 60 * 60_000).toISOString();
		createEvent(db, {
			babyId: 'baby-1',
			caregiverId: 'cg-1',
			type: 'nursing',
			startedAt: past,
			endedAt: new Date(Date.now() - 50 * 60_000).toISOString(),
			note: null,
			details: {
				segments: [
					{ side: 'left', startedAt: past, endedAt: new Date(Date.now() - 50 * 60_000).toISOString() }
				]
			}
		});

		const started = performQuick(db, { action: 'nursing' }, ctx);
		expect(started.speech).toBe('Tétée côté droit démarrée');
	});

	it('starts on the left when no nursing session was ever recorded', () => {
		expect(performQuick(db, { action: 'nursing' }, ctx).speech).toBe('Tétée côté gauche démarrée');
	});
});

describe('baby resolution', () => {
	it('resolves the only baby without being told which', () => {
		expect(performQuick(db, { action: 'sleep' }, ctx).event.babyId).toBe('baby-1');
	});

	it('refuses to guess between several babies', () => {
		db = openDb(':memory:');
		seed(db, ['baby-1', 'baby-2']);

		expect(() => performQuick(db, { action: 'sleep' }, ctx)).toThrow(QuickError);
		try {
			performQuick(db, { action: 'sleep' }, ctx);
		} catch (e) {
			expect((e as QuickError).code).toBe('ambiguous_baby');
		}
	});

	it('takes an explicit babyId as the way out of the ambiguity', () => {
		db = openDb(':memory:');
		seed(db, ['baby-1', 'baby-2']);

		const result = performQuick(db, { action: 'sleep', babyId: 'baby-2' }, ctx);
		expect(result.event.babyId).toBe('baby-2');
	});

	it('refuses when the household has no baby at all', () => {
		db = openDb(':memory:');

		expect(() => performQuick(db, { action: 'sleep' }, ctx)).toThrow(QuickError);
	});
});

describe('attribution and broadcast', () => {
	it('attributes the write to the context caregiver, or to nobody', () => {
		expect(performQuick(db, { action: 'diaper', kind: 'wet' }, ctx).event.caregiverId).toBe('cg-1');
		expect(
			performQuick(db, { action: 'diaper', kind: 'wet' }, { caregiverId: null }).event.caregiverId
		).toBeNull();
	});

	it('publishes every write on the SSE bus', () => {
		const logged = performQuick(db, { action: 'bottle', volumeMl: 90 }, ctx);
		expect(changes).toEqual([{ kind: 'created', event: logged.event }]);

		changes = [];
		const started = performQuick(db, { action: 'sleep' }, ctx);
		expect(changes).toEqual([{ kind: 'created', event: started.event }]);

		changes = [];
		const stopped = performQuick(db, { action: 'sleep' }, ctx);
		expect(changes).toEqual([{ kind: 'updated', event: stopped.event }]);
	});
});
