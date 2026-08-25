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

import { listActiveTimers, startTimer, stopTimer, nursingAction } from './repo';
import type { NursingSegment } from './types';

describe('timers (FR-013, AC-004)', () => {
	it('starts a sleep timer with server start time and no end', () => {
		const { created, event } = startTimer(db, { type: 'sleep', babyId: 'baby-1' });
		expect(created).toBe(true);
		expect(event.endedAt).toBeNull();
		expect(listActiveTimers(db, 'baby-1').map((e) => e.id)).toEqual([event.id]);
	});

	it('concurrent start returns the existing session instead of creating one', () => {
		const first = startTimer(db, { type: 'sleep', babyId: 'baby-1' });
		const second = startTimer(db, { type: 'sleep', babyId: 'baby-1' });
		expect(second.created).toBe(false);
		expect(second.event.id).toBe(first.event.id);
		expect(listActiveTimers(db, 'baby-1')).toHaveLength(1);
	});

	it('allows one active timer per category (sleep + nursing coexist)', () => {
		startTimer(db, { type: 'sleep', babyId: 'baby-1' });
		startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		expect(listActiveTimers(db, 'baby-1')).toHaveLength(2);
	});

	it('stops the active timer; stopping again throws no_active_timer', () => {
		startTimer(db, { type: 'sleep', babyId: 'baby-1' });
		const stopped = stopTimer(db, { type: 'sleep', babyId: 'baby-1' });
		expect(stopped.endedAt).not.toBeNull();
		expect(() => stopTimer(db, { type: 'sleep', babyId: 'baby-1' })).toThrowError(RepoError);
	});

	it('pump start records side, stop records the volume', () => {
		startTimer(db, { type: 'pump', babyId: 'baby-1', side: 'both' });
		const stopped = stopTimer(db, { type: 'pump', babyId: 'baby-1', volumeMl: 120 });
		expect(stopped.details).toEqual({ side: 'both', volumeMl: 120 });
	});

	it('soft-deleting an active timer frees the slot', () => {
		const { event } = startTimer(db, { type: 'sleep', babyId: 'baby-1' });
		softDeleteEvent(db, event.id);
		expect(startTimer(db, { type: 'sleep', babyId: 'baby-1' }).created).toBe(true);
		expect(() => restoreEvent(db, event.id)).toThrowError(RepoError); // timer_conflict
	});
});

describe('nursing session (FR-002, AC-002 segments)', () => {
	const segs = (e: { details: unknown }) => (e.details as { segments: NursingSegment[] }).segments;

	it('start opens a segment on the chosen side', () => {
		const { event } = startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		expect(segs(event)).toHaveLength(1);
		expect(segs(event)[0].side).toBe('left');
		expect(segs(event)[0].endedAt).toBeNull();
	});

	it('pause closes the open segment (paused time lives in no segment — DEC-001)', () => {
		startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		const paused = nursingAction(db, { babyId: 'baby-1', action: 'pause' });
		expect(segs(paused).every((s) => s.endedAt !== null)).toBe(true);
		expect(paused.endedAt).toBeNull(); // still active
	});

	it('resume opens a new segment on the last side by default', () => {
		startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		nursingAction(db, { babyId: 'baby-1', action: 'pause' });
		const resumed = nursingAction(db, { babyId: 'baby-1', action: 'resume' });
		expect(segs(resumed)).toHaveLength(2);
		expect(segs(resumed)[1].side).toBe('left');
		expect(segs(resumed)[1].endedAt).toBeNull();
	});

	it('switch-side closes the segment and opens the other side', () => {
		startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		const switched = nursingAction(db, { babyId: 'baby-1', action: 'switch-side' });
		expect(segs(switched)).toHaveLength(2);
		expect(segs(switched)[0].endedAt).not.toBeNull();
		expect(segs(switched)[1].side).toBe('right');
	});

	it('rejects pause while paused and resume while running', () => {
		startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		expect(() => nursingAction(db, { babyId: 'baby-1', action: 'resume' })).toThrowError(RepoError);
		nursingAction(db, { babyId: 'baby-1', action: 'pause' });
		expect(() => nursingAction(db, { babyId: 'baby-1', action: 'pause' })).toThrowError(RepoError);
	});

	it('stop closes the open segment at endedAt', () => {
		startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'right' });
		const stopped = stopTimer(db, { type: 'nursing', babyId: 'baby-1' });
		expect(stopped.endedAt).not.toBeNull();
		expect(segs(stopped).every((s) => s.endedAt !== null)).toBe(true);
	});
});

import { patchEvent } from './repo';

describe('stopTimer validates the merged session (FR-017)', () => {
	it('rejects an endedAt before the session start', () => {
		startTimer(db, { type: 'sleep', babyId: 'baby-1', startedAt: '2026-08-23T11:00:00.000Z' });
		expect(() =>
			stopTimer(db, {
				type: 'sleep',
				babyId: 'baby-1',
				endedAt: '2026-08-23T10:00:00.000Z'
			})
		).toThrowError(RepoError);
		// The session must stay open rather than persist end < start.
		expect(listActiveTimers(db, 'baby-1')).toHaveLength(1);
	});

	it('never persists an end before the start of a future-dated session', () => {
		const startedAt = new Date(Date.now() + 60_000).toISOString();
		startTimer(db, { type: 'sleep', babyId: 'baby-1', startedAt });
		expect(() => stopTimer(db, { type: 'sleep', babyId: 'baby-1' })).toThrowError(RepoError);
		expect(listActiveTimers(db, 'baby-1')).toHaveLength(1);
	});

	it('rejects stopping a pump without a volume (FR-004)', () => {
		startTimer(db, { type: 'pump', babyId: 'baby-1', side: 'left' });
		expect(() => stopTimer(db, { type: 'pump', babyId: 'baby-1' })).toThrowError(RepoError);
		expect(() =>
			stopTimer(db, { type: 'pump', babyId: 'baby-1', volumeMl: null })
		).toThrowError(RepoError);
		expect(stopTimer(db, { type: 'pump', babyId: 'baby-1', volumeMl: 90 }).endedAt).not.toBeNull();
	});
});

describe('patchEvent merges and validates atomically', () => {
	it('applies a valid patch', () => {
		const created = createEvent(db, bottle());
		const patched = patchEvent(db, created.id, { note: 'calmer' }, new Date());
		expect(patched.note).toBe('calmer');
	});

	it('rejects a patch that would put endedAt before startedAt', () => {
		const { event } = startTimer(db, {
			type: 'sleep',
			babyId: 'baby-1',
			startedAt: '2026-08-23T11:00:00.000Z'
		});
		expect(() =>
			patchEvent(db, event.id, { endedAt: '2026-08-23T10:00:00.000Z' }, new Date())
		).toThrowError(RepoError);
		expect(getEvent(db, event.id)?.endedAt).toBeNull();
	});

	it('rejects patching an active nursing session to an empty segment list', () => {
		const { event } = startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		expect(() =>
			patchEvent(db, event.id, { details: { segments: [] } }, new Date())
		).toThrowError(RepoError);
	});

	it('throws not_found on an unknown id', () => {
		expect(() => patchEvent(db, 'nope', { note: 'x' }, new Date())).toThrowError(RepoError);
	});

	it('rejects patching an endedAt onto a point event (bottle, diaper)', () => {
		const created = createEvent(db, bottle());
		expect(() =>
			patchEvent(db, created.id, { endedAt: '2026-08-23T11:05:00.000Z' }, new Date())
		).toThrowError(RepoError);
		expect(getEvent(db, created.id)?.endedAt).toBeNull();
	});
});

describe('patchEvent validates nursing segments (review item 7)', () => {
	function completedNursing(): { id: string } {
		return createEvent(
			db,
			bottle({
				type: 'nursing',
				startedAt: '2026-08-23T11:00:00.000Z',
				endedAt: '2026-08-23T11:30:00.000Z',
				details: {
					segments: [
						{ side: 'left', startedAt: '2026-08-23T11:00:00.000Z', endedAt: '2026-08-23T11:10:00.000Z' },
						{ side: 'right', startedAt: '2026-08-23T11:12:00.000Z', endedAt: '2026-08-23T11:30:00.000Z' }
					]
				}
			})
		);
	}

	it('rejects overlapping segments', () => {
		const { id } = completedNursing();
		expect(() =>
			patchEvent(
				db,
				id,
				{
					details: {
						segments: [
							{ side: 'left', startedAt: '2026-08-23T11:00:00.000Z', endedAt: '2026-08-23T11:15:00.000Z' },
							// Starts before the first segment ends: overlap.
							{ side: 'right', startedAt: '2026-08-23T11:10:00.000Z', endedAt: '2026-08-23T11:30:00.000Z' }
						]
					}
				},
				new Date()
			)
		).toThrowError(RepoError);
	});

	it('rejects out-of-order segments (second segment starts before the first)', () => {
		const { id } = completedNursing();
		expect(() =>
			patchEvent(
				db,
				id,
				{
					details: {
						segments: [
							{ side: 'left', startedAt: '2026-08-23T11:15:00.000Z', endedAt: '2026-08-23T11:30:00.000Z' },
							{ side: 'right', startedAt: '2026-08-23T11:00:00.000Z', endedAt: '2026-08-23T11:10:00.000Z' }
						]
					}
				},
				new Date()
			)
		).toThrowError(RepoError);
	});

	it('rejects a segment starting before the session started', () => {
		const { id } = completedNursing();
		expect(() =>
			patchEvent(
				db,
				id,
				{
					details: {
						// Session starts 11:00; this segment starts 10:55.
						segments: [{ side: 'left', startedAt: '2026-08-23T10:55:00.000Z', endedAt: '2026-08-23T11:10:00.000Z' }]
					}
				},
				new Date()
			)
		).toThrowError(RepoError);
	});

	it('rejects a segment ending after the session ended', () => {
		const { id } = completedNursing();
		expect(() =>
			patchEvent(
				db,
				id,
				{
					details: {
						// Session ends 11:30; this segment ends 11:45.
						segments: [{ side: 'left', startedAt: '2026-08-23T11:00:00.000Z', endedAt: '2026-08-23T11:45:00.000Z' }]
					}
				},
				new Date()
			)
		).toThrowError(RepoError);
	});

	it('accepts chronological, non-overlapping, contained segments', () => {
		const { id } = completedNursing();
		const patched = patchEvent(
			db,
			id,
			{
				details: {
					segments: [
						{ side: 'left', startedAt: '2026-08-23T11:00:00.000Z', endedAt: '2026-08-23T11:05:00.000Z' },
						{ side: 'right', startedAt: '2026-08-23T11:05:00.000Z', endedAt: '2026-08-23T11:30:00.000Z' }
					]
				}
			},
			new Date()
		);
		expect(patched.details).toEqual({
			segments: [
				{ side: 'left', startedAt: '2026-08-23T11:00:00.000Z', endedAt: '2026-08-23T11:05:00.000Z' },
				{ side: 'right', startedAt: '2026-08-23T11:05:00.000Z', endedAt: '2026-08-23T11:30:00.000Z' }
			]
		});
	});
});

describe('nursing action hardening', () => {
	it('switch-side honours a client-supplied target side', () => {
		startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		const switched = nursingAction(db, {
			babyId: 'baby-1',
			action: 'switch-side',
			side: 'right'
		});
		const segments = (switched.details as { segments: NursingSegment[] }).segments;
		expect(segments).toHaveLength(2);
		expect(segments[0].endedAt).not.toBeNull();
		expect(segments[1].side).toBe('right');
	});

	it('switch-side is a no-op when the target side is already running', () => {
		// Multi-device race: this client's view is stale and another device
		// already switched to the requested side — the session must not flip
		// back or grow an extra segment.
		startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		const unchanged = nursingAction(db, {
			babyId: 'baby-1',
			action: 'switch-side',
			side: 'left'
		});
		const segments = (unchanged.details as { segments: NursingSegment[] }).segments;
		expect(segments).toHaveLength(1);
		expect(segments[0].side).toBe('left');
		expect(segments[0].endedAt).toBeNull();
	});

	it('switch-side with a target opens that side when the session is paused', () => {
		startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		nursingAction(db, { babyId: 'baby-1', action: 'pause' });
		const resumed = nursingAction(db, {
			babyId: 'baby-1',
			action: 'switch-side',
			side: 'left'
		});
		const segments = (resumed.details as { segments: NursingSegment[] }).segments;
		expect(segments).toHaveLength(2);
		expect(segments[1].side).toBe('left');
		expect(segments[1].endedAt).toBeNull();
	});

	it('rejects actions on a session with no segments', () => {
		const { event } = startTimer(db, { type: 'nursing', babyId: 'baby-1', side: 'left' });
		// Bypass validation to simulate a corrupted row.
		db.prepare('UPDATE event SET details = ? WHERE id = ?').run('{"segments":[]}', event.id);
		for (const action of ['pause', 'resume', 'switch-side'] as const)
			expect(() => nursingAction(db, { babyId: 'baby-1', action })).toThrowError(RepoError);
	});
});

describe('listEvents overlap mode (history day view, AC-006)', () => {
	it('default mode (starts-in-window) misses a sleep that started the prior day', () => {
		const sleepEvent = createEvent(
			db,
			bottle({
				type: 'sleep',
				details: {},
				startedAt: '2026-08-24T23:30:00.000Z',
				endedAt: '2026-08-25T01:30:00.000Z'
			})
		);
		const defaultListing = listEvents(db, {
			babyId: 'baby-1',
			from: '2026-08-25T00:00:00.000Z',
			to: '2026-08-26T00:00:00.000Z'
		});
		expect(defaultListing.map((e) => e.id)).not.toContain(sleepEvent.id);

		const overlapListing = listEvents(db, {
			babyId: 'baby-1',
			from: '2026-08-25T00:00:00.000Z',
			to: '2026-08-26T00:00:00.000Z',
			overlap: true
		});
		expect(overlapListing.map((e) => e.id)).toContain(sleepEvent.id);
	});

	it('overlap mode includes an active (null-ended) timer started before the window', () => {
		const activeSleep = createEvent(
			db,
			bottle({
				type: 'sleep',
				details: {},
				startedAt: '2026-08-24T23:30:00.000Z',
				endedAt: null
			})
		);
		const overlapListing = listEvents(db, {
			babyId: 'baby-1',
			from: '2026-08-25T00:00:00.000Z',
			to: '2026-08-26T00:00:00.000Z',
			overlap: true
		});
		expect(overlapListing.map((e) => e.id)).toContain(activeSleep.id);
	});

	it('overlap mode still excludes events entirely outside the window', () => {
		createEvent(
			db,
			bottle({ startedAt: '2026-08-20T10:00:00.000Z', endedAt: null })
		);
		const overlapListing = listEvents(db, {
			babyId: 'baby-1',
			from: '2026-08-25T00:00:00.000Z',
			to: '2026-08-26T00:00:00.000Z',
			overlap: true
		});
		expect(overlapListing).toHaveLength(0);
	});

	it('a timer ending exactly at `from` has zero overlap with a half-open [from, to) window', () => {
		createEvent(
			db,
			bottle({
				type: 'sleep',
				details: {},
				startedAt: '2026-08-24T22:00:00.000Z',
				endedAt: '2026-08-25T00:00:00.000Z' // == from, below
			})
		);
		const overlapListing = listEvents(db, {
			babyId: 'baby-1',
			from: '2026-08-25T00:00:00.000Z',
			to: '2026-08-26T00:00:00.000Z',
			overlap: true
		});
		expect(overlapListing).toHaveLength(0);
	});
});
