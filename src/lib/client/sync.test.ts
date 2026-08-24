import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncStore } from './sync.svelte';
import type { EventDTO, SyncKind } from './types';

const NOW = new Date('2026-08-24T14:00:00.000Z');

function makeEvent(over: Partial<EventDTO> = {}): EventDTO {
	const at = NOW.toISOString();
	return {
		id: 'ev-1',
		babyId: 'baby-1',
		caregiverId: 'cg-1',
		type: 'diaper',
		startedAt: at,
		endedAt: null,
		note: null,
		details: { pee: true, poo: false },
		createdAt: at,
		updatedAt: at,
		deletedAt: null,
		...over
	};
}

function sleepTimer(over: Partial<EventDTO> = {}): EventDTO {
	return makeEvent({
		id: 'timer-1',
		type: 'sleep',
		details: {},
		endedAt: null,
		...over
	});
}

function sync(kind: SyncKind, event: EventDTO, serverTime = NOW.toISOString()) {
	return { kind, event, serverTime };
}

let store: SyncStore;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	store = new SyncStore();
	store.babyId = 'baby-1';
});

afterEach(() => {
	store.stop();
	vi.useRealTimers();
});

describe('applyChange', () => {
	it('inserts an event created today', () => {
		store.applyChange(sync('created', makeEvent()));
		expect(store.events.map((e) => e.id)).toEqual(['ev-1']);
	});

	it('ignores an event outside today', () => {
		const yesterday = new Date(NOW.getTime() - 36 * 3_600_000).toISOString();
		store.applyChange(sync('created', makeEvent({ startedAt: yesterday })));
		expect(store.events).toHaveLength(0);
	});

	it('ignores events of another baby', () => {
		store.applyChange(sync('created', makeEvent({ babyId: 'baby-2' })));
		expect(store.events).toHaveLength(0);
	});

	it('upserts on update instead of duplicating', () => {
		store.applyChange(sync('created', makeEvent()));
		store.applyChange(sync('updated', makeEvent({ note: 'beaucoup' })));
		expect(store.events).toHaveLength(1);
		expect(store.events[0].note).toBe('beaucoup');
	});

	it('removes on delete and puts it back on restore', () => {
		store.applyChange(sync('created', makeEvent()));
		store.applyChange(sync('deleted', makeEvent({ deletedAt: NOW.toISOString() })));
		expect(store.events).toHaveLength(0);
		store.applyChange(sync('restored', makeEvent()));
		expect(store.events.map((e) => e.id)).toEqual(['ev-1']);
	});

	it('keeps events sorted by startedAt descending', () => {
		const older = new Date(NOW.getTime() - 3_600_000).toISOString();
		store.applyChange(sync('created', makeEvent({ id: 'old', startedAt: older })));
		store.applyChange(sync('created', makeEvent({ id: 'new' })));
		expect(store.events.map((e) => e.id)).toEqual(['new', 'old']);
	});
});

describe('timer membership', () => {
	it('adds an active timer and drops it once endedAt is set', () => {
		store.applyChange(sync('created', sleepTimer()));
		expect(store.timers.map((t) => t.id)).toEqual(['timer-1']);

		store.applyChange(sync('updated', sleepTimer({ endedAt: NOW.toISOString() })));
		expect(store.timers).toHaveLength(0);
		expect(store.events.map((e) => e.id)).toEqual(['timer-1']);
	});

	it('drops a deleted timer from both lists', () => {
		store.applyChange(sync('created', sleepTimer()));
		store.applyChange(sync('deleted', sleepTimer({ deletedAt: NOW.toISOString() })));
		expect(store.timers).toHaveLength(0);
		expect(store.events).toHaveLength(0);
	});
});

describe('server time is authoritative (RISK-001)', () => {
	it('derives the offset from a snapshot 30 s ahead of the client clock', () => {
		const serverTime = new Date(NOW.getTime() + 30_000).toISOString();
		store.applySnapshot({ serverTime, activeTimers: [sleepTimer()] });
		expect(store.serverOffsetMs).toBe(30_000);
		expect(store.nowMs).toBe(NOW.getTime() + 30_000);
		expect(store.timers.map((t) => t.id)).toEqual(['timer-1']);
	});

	it('keeps refreshing the offset from sync messages', () => {
		store.applyChange(sync('created', makeEvent(), new Date(NOW.getTime() - 5_000).toISOString()));
		expect(store.serverOffsetMs).toBe(-5_000);
	});
});

describe('connected transitions', () => {
	it('goes true on open, false on error, true again on a fresh snapshot (FR-012/AC-005)', () => {
		expect(store.connected).toBe(false);
		store.handleOpen();
		expect(store.connected).toBe(true);
		store.handleError();
		expect(store.connected).toBe(false);
		store.applySnapshot({ serverTime: NOW.toISOString(), activeTimers: [] });
		expect(store.connected).toBe(true);
	});
});

describe('applyReset (slice 5 data restore)', () => {
	it('re-derives the offset like a snapshot, harmless when the server never sends it', () => {
		const serverTime = new Date(NOW.getTime() + 10_000).toISOString();
		store.applyReset({ serverTime });
		expect(store.serverOffsetMs).toBe(10_000);
		expect(store.nowMs).toBe(NOW.getTime() + 10_000);
	});
});
