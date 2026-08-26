import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listBabies, listCaregivers, listEvents } from '$lib/client/api';
import { localDayKey } from '$lib/client/summaries';
import { SyncStore, type ActivitySyncAdapter } from '$lib/client/sync.svelte';
import type { EventDTO, SyncKind } from '$lib/client/types';
import { HistoryWindow } from './historyWindow.svelte';

vi.mock('$lib/client/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/client/api')>();
	return {
		// ApiError is a real class the module under test narrows on.
		ApiError: actual.ApiError,
		listBabies: vi.fn(),
		listCaregivers: vi.fn(),
		listEvents: vi.fn(),
		listTodayEvents: vi.fn(),
		getTimers: vi.fn()
	};
});

// Local noon, so every derived local day key is unambiguous whatever the TZ.
const NOW = new Date(2026, 7, 24, 12, 0, 0);
const TODAY = localDayKey(NOW);
const YESTERDAY = localDayKey(new Date(2026, 7, 23));

function makeEvent(over: Partial<EventDTO> = {}): EventDTO {
	const at = new Date(2026, 7, 24, 9, 0, 0).toISOString();
	return {
		id: 'ev-1',
		babyId: 'baby-1',
		caregiverId: null,
		type: 'bottle',
		startedAt: at,
		endedAt: null,
		note: null,
		details: { milkType: 'formula', volumeMl: 120 },
		createdAt: at,
		updatedAt: at,
		deletedAt: null,
		...over
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Lets every already-resolved promise chain settle under fake timers. */
async function flush(): Promise<void> {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

function sync(kind: SyncKind, event: EventDTO) {
	return { kind, event, serverTime: NOW.toISOString() };
}

let store: SyncStore;
let adapter: ActivitySyncAdapter;
let view: HistoryWindow;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	vi.mocked(listBabies).mockResolvedValue([
		{ id: 'baby-1', name: 'Bébé', birthdate: '2026-08-01', timezone: 'America/Toronto' }
	]);
	vi.mocked(listCaregivers).mockResolvedValue([]);
	vi.mocked(listEvents).mockResolvedValue([]);
	store = new SyncStore(undefined, (ownedAdapter) => {
		adapter = ownedAdapter;
	});
	view = new HistoryWindow(store);
});

afterEach(() => {
	view.stop();
	store.stop();
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('initial window', () => {
	it('opens on today, in day mode', () => {
		expect(view.dayKey).toBe(TODAY);
		expect(view.viewMode).toBe('day');
	});

	it('start() resolves the baby, starts the sync store and loads the day', async () => {
		view.start();
		await flush();
		expect(view.babyId).toBe('baby-1');
		expect(store.babyId).toBe('baby-1');
		expect(vi.mocked(listEvents)).toHaveBeenCalledTimes(1);
	});

	it('subscribes before starting the sync store and reconciles a confirmed change without refetching', async () => {
		view.start();
		await flush();
		vi.mocked(listEvents).mockClear();

		adapter.change(sync('created', makeEvent()));
		expect(view.dayEvents.map((event) => event.id)).toEqual(['ev-1']);
		expect(vi.mocked(listEvents)).not.toHaveBeenCalled();
	});

	it('stop() unsubscribes: a later change no longer refetches', async () => {
		view.start();
		await flush();
		view.stop();
		vi.mocked(listEvents).mockClear();

		adapter.change(sync('created', makeEvent()));
		expect(vi.mocked(listEvents)).not.toHaveBeenCalled();
	});
});

describe('out-of-order day responses (the CI race behind #19)', () => {
	beforeEach(() => {
		view.babyId = 'baby-1';
	});

	it('an earlier-issued but slower response never clobbers a newer one', async () => {
		const slow = deferred<EventDTO[]>();
		const fast = deferred<EventDTO[]>();
		vi.mocked(listEvents).mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

		const first = view.loadDay();
		const second = view.loadDay();

		fast.resolve([makeEvent({ id: 'newer' })]);
		await second;
		slow.resolve([makeEvent({ id: 'older' })]);
		await first;

		expect(view.dayEvents.map((e) => e.id)).toEqual(['newer']);
	});

	it('a stale failure never overwrites a newer success with an error banner', async () => {
		const failing = deferred<EventDTO[]>();
		const ok = deferred<EventDTO[]>();
		vi.mocked(listEvents).mockReturnValueOnce(failing.promise).mockReturnValueOnce(ok.promise);

		const first = view.loadDay();
		const second = view.loadDay();

		ok.resolve([makeEvent({ id: 'newer' })]);
		await second;
		failing.reject(new Error('network'));
		await first;

		expect(view.loadError).toBeNull();
		expect(view.dayEvents.map((e) => e.id)).toEqual(['newer']);
	});

	it('changing the day mid-flight discards the previous day’s response', async () => {
		const yesterdayFetch = deferred<EventDTO[]>();
		const todayFetch = deferred<EventDTO[]>();
		vi.mocked(listEvents)
			.mockReturnValueOnce(yesterdayFetch.promise)
			.mockReturnValueOnce(todayFetch.promise);

		view.dayKey = YESTERDAY;
		const stale = view.loadDay();
		// The user moves back to today before yesterday's fetch lands.
		view.setDayKey(TODAY);

		todayFetch.resolve([makeEvent({ id: 'today' })]);
		await flush();
		yesterdayFetch.resolve([makeEvent({ id: 'yesterday' })]);
		await stale;

		expect(view.dayKey).toBe(TODAY);
		expect(view.dayEvents.map((e) => e.id)).toEqual(['today']);
	});

	it('week and previous-week windows have their own tokens', async () => {
		const slow = deferred<EventDTO[]>();
		const fast = deferred<EventDTO[]>();
		vi.mocked(listEvents).mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

		const first = view.loadWeek();
		const second = view.loadWeek();
		fast.resolve([makeEvent({ id: 'newer' })]);
		await second;
		slow.resolve([makeEvent({ id: 'older' })]);
		await first;

		expect(view.weekEvents.map((e) => e.id)).toEqual(['newer']);
	});

	it('a superseded previous-week load leaves the newer comparison alone', async () => {
		const slow = deferred<EventDTO[]>();
		const fast = deferred<EventDTO[]>();
		vi.mocked(listEvents).mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

		const first = view.loadPrevWeek();
		const second = view.loadPrevWeek();
		fast.resolve([makeEvent({ id: 'newer' })]);
		await second;
		slow.reject(new Error('network'));
		await first;

		expect(view.prevWeekEvents?.map((e) => e.id)).toEqual(['newer']);
	});

	it('replays a confirmed change that arrives while the day baseline is in flight', async () => {
		const baseline = deferred<EventDTO[]>();
		vi.mocked(listEvents).mockReturnValueOnce(baseline.promise);
		view.start();
		await flush();

		adapter.change(sync('created', makeEvent({ id: 'confirmed' })));
		baseline.resolve([makeEvent({ id: 'baseline' })]);
		await flush();

		expect(view.dayEvents.map((event) => event.id).sort()).toEqual(['baseline', 'confirmed']);
	});

	it('keeps a newer fetched baseline when replaying a stale buffered change', async () => {
		const baseline = deferred<EventDTO[]>();
		vi.mocked(listEvents).mockReturnValueOnce(baseline.promise);
		view.start();
		await flush();
		const stale = makeEvent({ note: 'stale' });
		const newer = makeEvent({
			note: 'newer baseline',
			updatedAt: new Date(NOW.getTime() + 1_000).toISOString()
		});

		adapter.change(sync('updated', stale));
		baseline.resolve([newer]);
		await flush();

		expect(view.dayEvents).toEqual([newer]);
	});

	it('replays confirmed changes onto current and previous week baselines in flight', async () => {
		view.start();
		await flush();
		const weekBaseline = deferred<EventDTO[]>();
		const previousBaseline = deferred<EventDTO[]>();
		vi.mocked(listEvents)
			.mockReturnValueOnce(weekBaseline.promise)
			.mockReturnValueOnce(previousBaseline.promise);

		view.setViewMode('week');
		adapter.change(sync('created', makeEvent({ id: 'current' })));
		adapter.change(
			sync(
				'created',
				makeEvent({ id: 'previous', startedAt: new Date(2026, 7, 18, 9).toISOString() })
			)
		);
		expect(view.prevWeekEvents).toBeNull();
		weekBaseline.resolve([]);
		previousBaseline.resolve([]);
		await flush();

		expect(view.weekEvents.map((event) => event.id)).toEqual(['current']);
		expect(view.prevWeekEvents?.map((event) => event.id)).toEqual(['previous']);
	});
});

describe('skeleton timer', () => {
	beforeEach(() => {
		view.babyId = 'baby-1';
	});

	it('stays hidden when the load resolves before the delay', async () => {
		await view.loadDay();
		vi.advanceTimersByTime(1000);
		expect(view.showSkeleton).toBe(false);
		expect(view.loading).toBe(false);
	});

	it('appears once a load is slow enough', async () => {
		const slow = deferred<EventDTO[]>();
		vi.mocked(listEvents).mockReturnValueOnce(slow.promise);
		const pending = view.loadDay();
		vi.advanceTimersByTime(400);
		expect(view.showSkeleton).toBe(true);
		slow.resolve([]);
		await pending;
		expect(view.showSkeleton).toBe(false);
	});

	it('a superseded load’s orphaned timer can never flip the skeleton back on', async () => {
		const slow = deferred<EventDTO[]>();
		const fast = deferred<EventDTO[]>();
		vi.mocked(listEvents).mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

		const first = view.loadDay(); // its skeleton timer is still armed
		const second = view.loadDay();
		fast.resolve([makeEvent({ id: 'newer' })]);
		await second;
		expect(view.showSkeleton).toBe(false);

		// The first call's timer fires while the first call is still in flight:
		// its token no longer matches, so it must not touch the newer call's state.
		vi.advanceTimersByTime(400);
		expect(view.showSkeleton).toBe(false);

		slow.resolve([]);
		await first;
		expect(view.showSkeleton).toBe(false);
		expect(view.loading).toBe(false);
	});
});

describe('visibleDayEvents', () => {
	it('hides soft-deleted events', () => {
		view.dayEvents = [makeEvent({ deletedAt: NOW.toISOString() })];
		expect(view.visibleDayEvents).toHaveLength(0);
	});

	it('keeps a session that only overlaps the day, not merely one starting in it', () => {
		const startedAt = new Date(2026, 7, 23, 23, 30).toISOString();
		const endedAt = new Date(2026, 7, 24, 1, 30).toISOString();
		view.dayEvents = [makeEvent({ id: 'carry-over', type: 'sleep', details: {}, startedAt, endedAt })];
		expect(view.visibleDayEvents.map((e) => e.id)).toEqual(['carry-over']);
	});
});

describe('window changes', () => {
	beforeEach(() => {
		view.babyId = 'baby-1';
	});

	it('switching to the week view loads both week windows once', async () => {
		view.setViewMode('week');
		await flush();
		expect(vi.mocked(listEvents)).toHaveBeenCalledTimes(2);
	});

	it('switching back to the day view refetches nothing: the day window was never dropped', async () => {
		view.setViewMode('week');
		await flush();
		vi.mocked(listEvents).mockClear();
		view.setViewMode('day');
		await flush();
		expect(vi.mocked(listEvents)).not.toHaveBeenCalled();
	});

	it('re-selecting the current mode or day is a no-op', async () => {
		view.setViewMode('day');
		view.setDayKey(view.dayKey);
		await flush();
		expect(vi.mocked(listEvents)).not.toHaveBeenCalled();
	});

	it('changing the day in the week view reloads all three windows', async () => {
		view.setViewMode('week');
		await flush();
		vi.mocked(listEvents).mockClear();
		view.setDayKey(YESTERDAY);
		await flush();
		expect(vi.mocked(listEvents)).toHaveBeenCalledTimes(3);
	});

	it('picking a day inside the week view zooms into it and loads only that day', async () => {
		view.setViewMode('week');
		await flush();
		vi.mocked(listEvents).mockClear();
		view.selectWeekDay(YESTERDAY);
		await flush();
		expect(view.viewMode).toBe('day');
		expect(view.dayKey).toBe(YESTERDAY);
		expect(vi.mocked(listEvents)).toHaveBeenCalledTimes(1);
	});

	it('derives the Monday of the selected week and the one before it', () => {
		view.setDayKey('2026-08-27'); // a Thursday
		expect(view.mondayKey).toBe('2026-08-24');
		expect(view.prevMondayKey).toBe('2026-08-17');
	});
});

describe('relayed changes (SSE and data restore)', () => {
	beforeEach(async () => {
		view.start();
		await flush();
		vi.mocked(listEvents).mockClear();
	});

	it('a sync message reconciles the day window without a refetch', () => {
		adapter.change(sync('updated', makeEvent()));
		expect(view.dayEvents.map((event) => event.id)).toEqual(['ev-1']);
		expect(vi.mocked(listEvents)).not.toHaveBeenCalled();
	});

	it('keeps the day window ordered by start time', () => {
		const morning = makeEvent({ id: 'morning', startedAt: new Date(2026, 7, 24, 8).toISOString() });
		const evening = makeEvent({ id: 'evening', startedAt: new Date(2026, 7, 24, 20).toISOString() });
		adapter.change(sync('created', evening));
		adapter.change(sync('created', morning));

		expect(view.dayEvents.map((event) => event.id)).toEqual(['morning', 'evening']);
		expect(vi.mocked(listEvents)).not.toHaveBeenCalled();
	});

	it('does not regress or delete a newer version when stale SSE arrives later', () => {
		const newer = makeEvent({
			note: 'second',
			updatedAt: new Date(NOW.getTime() + 1_000).toISOString()
		});
		const olderDelete = makeEvent({ deletedAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
		adapter.change(sync('updated', newer));
		adapter.change(sync('deleted', olderDelete));

		expect(view.dayEvents).toEqual([newer]);
		expect(vi.mocked(listEvents)).not.toHaveBeenCalled();
	});

	it('applies delete and restore confirmations incrementally', () => {
		const created = makeEvent();
		const deleted = makeEvent({
			deletedAt: new Date(NOW.getTime() + 1_000).toISOString(),
			updatedAt: new Date(NOW.getTime() + 1_000).toISOString()
		});
		const restored = makeEvent({ updatedAt: new Date(NOW.getTime() + 2_000).toISOString() });

		adapter.change(sync('created', created));
		adapter.change(sync('deleted', deleted));
		expect(view.dayEvents).toEqual([]);
		adapter.change(sync('restored', restored));

		expect(view.dayEvents).toEqual([restored]);
		expect(vi.mocked(listEvents)).not.toHaveBeenCalled();
	});

	it('a reset (reconnect or restore) refetches too', () => {
		adapter.reset({ serverTime: NOW.toISOString() });
		expect(vi.mocked(listEvents)).toHaveBeenCalledTimes(1);
	});

	it('reconciles current and previous week membership without refetching', async () => {
		view.setViewMode('week');
		await flush();
		vi.mocked(listEvents).mockClear();
		adapter.change(sync('created', makeEvent()));
		const previousWeek = makeEvent({
			id: 'previous',
			startedAt: new Date(2026, 7, 18, 9).toISOString()
		});
		adapter.change(sync('created', previousWeek));

		expect(view.dayEvents.map((event) => event.id)).toEqual(['ev-1']);
		expect(view.weekEvents.map((event) => event.id)).toEqual(['ev-1']);
		expect(view.prevWeekEvents?.map((event) => event.id)).toEqual(['previous']);
		expect(vi.mocked(listEvents)).not.toHaveBeenCalled();
	});

	it('a change never resurrects the comparison after a failed previous-week load', async () => {
		// setViewMode('week') fetches the week, then the previous week.
		vi.mocked(listEvents)
			.mockResolvedValueOnce([])
			.mockRejectedValueOnce(new Error('network'));
		view.setViewMode('week');
		await flush();
		expect(view.prevWeekEvents).toBeNull();

		const previousWeek = makeEvent({
			id: 'previous',
			startedAt: new Date(2026, 7, 18, 9).toISOString()
		});
		adapter.change(sync('created', previousWeek));

		// null keeps « Semaine précédente » hidden; [] or ['previous'] would
		// render a comparison built on a window that was never loaded.
		expect(view.prevWeekEvents).toBeNull();
	});

	it('removes an edited activity that moved outside every loaded window', async () => {
		view.setViewMode('week');
		await flush();
		adapter.change(sync('created', makeEvent()));
		vi.mocked(listEvents).mockClear();

		adapter.change(
			sync(
				'updated',
				makeEvent({
					startedAt: new Date(2026, 7, 10, 9).toISOString(),
					updatedAt: new Date(NOW.getTime() + 1_000).toISOString()
				})
			)
		);

		expect(view.dayEvents).toEqual([]);
		expect(view.weekEvents).toEqual([]);
		expect(view.prevWeekEvents).toEqual([]);
		expect(vi.mocked(listEvents)).not.toHaveBeenCalled();
	});
});

describe('load errors', () => {
	it('surfaces a French message when the day fetch fails', async () => {
		view.babyId = 'baby-1';
		vi.mocked(listEvents).mockRejectedValueOnce(new Error('network'));
		await view.loadDay();
		expect(view.loadError).toBe('Impossible de charger l’historique.');
	});

	it('a failing previous-week fetch stays silent: the comparison is an extra', async () => {
		view.babyId = 'baby-1';
		vi.mocked(listEvents).mockRejectedValueOnce(new Error('network'));
		await view.loadPrevWeek();
		expect(view.prevWeekEvents).toBeNull();
		expect(view.loadError).toBeNull();
	});

	it('fetches nothing until a baby is known', async () => {
		await view.loadDay();
		await view.loadWeek();
		await view.loadPrevWeek();
		expect(vi.mocked(listEvents)).not.toHaveBeenCalled();
	});
});
