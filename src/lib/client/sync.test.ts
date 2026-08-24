import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listTodayEvents, getTimers } from './api';
import { SyncStore } from './sync.svelte';
import type { EventDTO, SyncKind } from './types';

vi.mock('./api', () => ({
	listTodayEvents: vi.fn(),
	getTimers: vi.fn()
}));

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
	vi.mocked(listTodayEvents).mockResolvedValue([]);
	vi.mocked(getTimers).mockResolvedValue({ serverTime: NOW.toISOString(), timers: [] });
	store = new SyncStore();
	store.babyId = 'baby-1';
});

afterEach(() => {
	store.stop();
	vi.useRealTimers();
	vi.clearAllMocks();
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
		store.applyChange(
			sync('updated', makeEvent({ note: 'beaucoup', updatedAt: new Date(NOW.getTime() + 1).toISOString() }))
		);
		expect(store.events).toHaveLength(1);
		expect(store.events[0].note).toBe('beaucoup');
	});

	it('removes on delete and puts it back on restore', () => {
		store.applyChange(sync('created', makeEvent()));
		store.applyChange(
			sync(
				'deleted',
				makeEvent({ deletedAt: NOW.toISOString(), updatedAt: new Date(NOW.getTime() + 1).toISOString() })
			)
		);
		expect(store.events).toHaveLength(0);
		store.applyChange(
			sync('restored', makeEvent({ updatedAt: new Date(NOW.getTime() + 2).toISOString() }))
		);
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

		store.applyChange(
			sync(
				'updated',
				sleepTimer({ endedAt: NOW.toISOString(), updatedAt: new Date(NOW.getTime() + 1).toISOString() })
			)
		);
		expect(store.timers).toHaveLength(0);
		expect(store.events.map((e) => e.id)).toEqual(['timer-1']);
	});

	it('drops a deleted timer from both lists', () => {
		store.applyChange(sync('created', sleepTimer()));
		store.applyChange(
			sync(
				'deleted',
				sleepTimer({ deletedAt: NOW.toISOString(), updatedAt: new Date(NOW.getTime() + 1).toISOString() })
			)
		);
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

describe('connectionState transitions (item 4)', () => {
	it('starts connecting, goes connected on open, disconnected on error, connected again on a fresh snapshot', () => {
		expect(store.connectionState).toBe('connecting');
		store.handleOpen();
		expect(store.connectionState).toBe('connected');
		store.handleError();
		expect(store.connectionState).toBe('disconnected');
		store.applySnapshot({ serverTime: NOW.toISOString(), activeTimers: [] });
		expect(store.connectionState).toBe('connected');
	});

	it('reports disconnected on an initial failure too (no more "ever connected" suppression)', () => {
		store.handleError();
		expect(store.connectionState).toBe('disconnected');
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

describe('applyServerEvent (HTTP-response merge, item 6)', () => {
	it('merges a confirmed write immediately, independent of SSE', () => {
		store.applyServerEvent(makeEvent({ id: 'from-http' }));
		expect(store.events.map((e) => e.id)).toEqual(['from-http']);
	});

	it('adopts an existing session returned by startTimer as {created:false, event} (no SSE for that path)', () => {
		const existingSession = sleepTimer({ id: 'adopted' });
		store.applyServerEvent(existingSession);
		expect(store.timers.map((t) => t.id)).toEqual(['adopted']);
	});
});

describe('idempotent upserts across HTTP/SSE races (item 5)', () => {
	it('SSE-then-HTTP: a stale HTTP response arriving after a newer SSE change does not regress state', () => {
		const older = makeEvent({ updatedAt: NOW.toISOString(), note: 'first' });
		const newer = makeEvent({ updatedAt: new Date(NOW.getTime() + 1000).toISOString(), note: 'second' });
		store.applyChange(sync('updated', newer));
		store.applyServerEvent(older);
		expect(store.events).toHaveLength(1);
		expect(store.events[0].note).toBe('second');
	});

	it('HTTP-then-SSE: the confirming SSE message for the same mutation does not duplicate', () => {
		const event = makeEvent({ updatedAt: NOW.toISOString() });
		store.applyServerEvent(event);
		store.applyChange(sync('created', event));
		expect(store.events).toHaveLength(1);
	});
});

describe('refreshEvents does not clobber a concurrent SSE change (item 2)', () => {
	it('keeps a change applied while a GET /api/events refresh is in flight', async () => {
		let resolveFetch!: (events: EventDTO[]) => void;
		const deferred = new Promise<EventDTO[]>((resolve) => {
			resolveFetch = resolve;
		});
		vi.mocked(listTodayEvents).mockReturnValueOnce(deferred);

		const refreshPromise = store.refreshEvents();
		store.applyChange(sync('created', makeEvent({ id: 'fresh' })));
		resolveFetch([makeEvent({ id: 'stale-snapshot' })]);
		await refreshPromise;

		expect(store.events.map((e) => e.id)).toEqual(['fresh']);
	});
});

describe('tick() and day rollover (item 3)', () => {
	it('refreshes today events only when the corrected clock crosses local midnight', () => {
		vi.setSystemTime(new Date(2026, 7, 24, 23, 59, 58));
		store.serverOffsetMs = 0;
		store.nowMs = Date.now();
		const spy = vi.spyOn(store, 'refreshEvents').mockResolvedValue();

		store.tick(); // still 23:59:59, same day
		expect(spy).not.toHaveBeenCalled();

		vi.setSystemTime(new Date(2026, 7, 25, 0, 0, 1));
		store.tick(); // crossed into the next day
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('uses the server-corrected clock, not the raw device clock, to detect the rollover', () => {
		vi.setSystemTime(new Date(2026, 7, 24, 23, 59, 57));
		store.serverOffsetMs = 2000; // server 2s ahead
		store.tick(); // establishes a corrected baseline (23:59:59), same day as the initial nowMs
		const spy = vi.spyOn(store, 'refreshEvents').mockResolvedValue();

		// The raw device clock only advances to 23:59:58 — still "today" on its own —
		// but the +2s server offset pushes the corrected clock past midnight.
		vi.setSystemTime(new Date(2026, 7, 24, 23, 59, 58));
		store.tick();
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('a day rollover prunes yesterday-only events from the store', async () => {
		const beforeMidnight = new Date(2026, 7, 24, 23, 59, 58);
		vi.setSystemTime(beforeMidnight);
		store.serverOffsetMs = 0;
		store.tick(); // establishes the pre-rollover baseline
		// serverTime must match the faked clock: applyChange re-derives nowMs/offset
		// from it, which would otherwise clobber the baseline just established above.
		store.applyChange(
			sync('created', makeEvent({ id: 'yesterday' }), beforeMidnight.toISOString())
		);
		expect(store.events).toHaveLength(1);

		vi.mocked(listTodayEvents).mockResolvedValueOnce([]);
		vi.setSystemTime(new Date(2026, 7, 25, 0, 0, 1));
		store.tick();
		// Flush the microtask queue: fake timers are active, so a real-timer-based
		// wait would never resolve; the mocked fetch settles on the microtask queue.
		await Promise.resolve();
		await Promise.resolve();
		expect(store.events).toHaveLength(0);
	});
});

describe('start() idempotency and cleanup (browser path, item 1)', () => {
	class FakeEventSource {
		static instances: FakeEventSource[] = [];
		closed = false;
		listeners: Record<string, Array<(e: unknown) => void>> = {};
		constructor(public url: string) {
			FakeEventSource.instances.push(this);
		}
		addEventListener(type: string, cb: (e: unknown) => void): void {
			(this.listeners[type] ??= []).push(cb);
		}
		close(): void {
			this.closed = true;
		}
	}

	beforeEach(() => {
		FakeEventSource.instances = [];
		vi.stubGlobal('window', {});
		vi.stubGlobal('EventSource', FakeEventSource);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('does not duplicate the connection/interval when start() repeats for the same baby', async () => {
		vi.resetModules();
		const { SyncStore: BrowserStore } = await import('./sync.svelte');
		const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
		const s = new BrowserStore();

		s.start('baby-1');
		s.start('baby-1'); // e.g. Today → History → Today remount

		expect(FakeEventSource.instances).toHaveLength(1);

		s.stop();
		expect(FakeEventSource.instances[0].closed).toBe(true);
		expect(clearIntervalSpy).toHaveBeenCalled();
	});

	it('tears down and reconnects when start() targets a different baby', async () => {
		vi.resetModules();
		const { SyncStore: BrowserStore } = await import('./sync.svelte');
		const s = new BrowserStore();

		s.start('baby-1');
		s.start('baby-2');

		expect(FakeEventSource.instances).toHaveLength(2);
		expect(FakeEventSource.instances[0].closed).toBe(true);
		expect(FakeEventSource.instances[1].closed).toBe(false);
		s.stop();
	});
});
