import { describe, expect, it, vi } from 'vitest';
import { SyncStore, type ActivitySyncAdapter } from './sync.svelte';
import type { ActivityChangeTransport } from './activityChanges';
import type { CreateEventInput, EventDTO } from './types';

const NOW = new Date('2026-08-25T14:00:00.000Z');

function diaper(overrides: Partial<EventDTO> = {}): EventDTO {
	return {
		id: 'diaper-1',
		babyId: 'baby-1',
		caregiverId: 'caregiver-1',
		type: 'diaper',
		startedAt: NOW.toISOString(),
		endedAt: null,
		note: null,
		details: { pee: true, poo: false },
		createdAt: NOW.toISOString(),
		updatedAt: NOW.toISOString(),
		deletedAt: null,
		...overrides
	};
}

function transport(): ActivityChangeTransport {
	return {
		create: vi.fn(),
		patch: vi.fn(),
		delete: vi.fn(),
		restore: vi.fn(),
		startTimer: vi.fn(),
		stopTimer: vi.fn(),
		nursingAction: vi.fn()
	};
}

let adapter: ActivitySyncAdapter;

function syncStore(http: ActivityChangeTransport): SyncStore {
	return new SyncStore(http, (ownedAdapter) => {
		adapter = ownedAdapter;
	});
}

describe('activity changes', () => {
	it('records a confirmed diaper in authoritative local state', async () => {
		const http = transport();
		const confirmed = diaper();
		vi.mocked(http.create).mockResolvedValue(confirmed);
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();
		const input: CreateEventInput = {
			babyId: 'baby-1',
			caregiverId: 'caregiver-1',
			type: 'diaper',
			startedAt: NOW.toISOString(),
			details: { pee: true, poo: false }
		};

		const result = await store.changes.create(input);

		expect(result).toEqual(confirmed);
		expect(store.events).toEqual([confirmed]);
	});

	it('removes a confirmed diaper and relays the same change to other views', async () => {
		const http = transport();
		const existing = diaper();
		const deleted = diaper({
			updatedAt: new Date(NOW.getTime() + 1_000).toISOString(),
			deletedAt: new Date(NOW.getTime() + 1_000).toISOString()
		});
		vi.mocked(http.delete).mockResolvedValue(deleted);
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();
		adapter.change({ kind: 'created', event: existing, serverTime: NOW.toISOString() });
		const changes: unknown[] = [];
		store.subscribeChanges((change) => changes.push(change));

		const result = await store.changes.delete(existing.id);

		expect(result).toEqual(deleted);
		expect(store.events).toEqual([]);
		expect(changes).toEqual([{ kind: 'deleted', event: deleted }]);
	});

	it('reconciles confirmed patch and restore intents', async () => {
		const http = transport();
		const existing = diaper();
		const edited = diaper({
			note: 'edited',
			updatedAt: new Date(NOW.getTime() + 1_000).toISOString()
		});
		const restored = diaper({ updatedAt: new Date(NOW.getTime() + 2_000).toISOString() });
		vi.mocked(http.patch).mockResolvedValue(edited);
		vi.mocked(http.restore).mockResolvedValue(restored);
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();
		adapter.change({ kind: 'created', event: existing, serverTime: NOW.toISOString() });
		const changes: unknown[] = [];
		store.subscribeChanges((change) => changes.push(change));

		await store.changes.patch(existing.id, { note: 'edited' });
		await store.changes.restore(existing.id);

		expect(store.events).toEqual([restored]);
		expect(changes).toEqual([
			{ kind: 'updated', event: edited },
			{ kind: 'restored', event: restored }
		]);
	});

	it('does not change or announce local state when the write fails', async () => {
		const http = transport();
		vi.mocked(http.create).mockRejectedValue(new Error('offline'));
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();
		const changes: unknown[] = [];
		store.subscribeChanges((change) => changes.push(change));

		await expect(
			store.changes.create({
				babyId: 'baby-1',
				type: 'diaper',
				startedAt: NOW.toISOString(),
				details: { pee: true, poo: false }
			})
		).rejects.toThrow('offline');

		expect(store.events).toEqual([]);
		expect(changes).toEqual([]);
	});

	it('resolves a confirmed transport result without incrementally reconciling across a restore reset', async () => {
		const http = transport();
		let resolveWrite!: (event: EventDTO) => void;
		vi.mocked(http.create).mockReturnValue(
			new Promise<EventDTO>((resolve) => {
				resolveWrite = resolve;
			})
		);
		const confirmed = diaper();
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();
		const changes: unknown[] = [];
		store.subscribeChanges((change) => changes.push(change));

		const write = store.changes.create({
			babyId: 'baby-1',
			type: 'diaper',
			startedAt: NOW.toISOString(),
			details: { pee: true, poo: false }
		});
		adapter.reset({ serverTime: NOW.toISOString() });
		resolveWrite(confirmed);
		await expect(write).resolves.toEqual(confirmed);

		expect(store.events).toEqual([]);
		expect(changes).toEqual([{ kind: 'reset' }, { kind: 'reset' }]);
	});

	it('reconciles a write that confirms after a reconnect snapshot', async () => {
		const http = transport();
		let resolveWrite!: (event: EventDTO) => void;
		vi.mocked(http.create).mockReturnValue(
			new Promise<EventDTO>((resolve) => {
				resolveWrite = resolve;
			})
		);
		const confirmed = diaper();
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();
		const changes: unknown[] = [];
		store.subscribeChanges((change) => changes.push(change));

		const write = store.changes.create({
			babyId: 'baby-1',
			type: 'diaper',
			startedAt: NOW.toISOString(),
			details: { pee: true, poo: false }
		});
		adapter.snapshot({ serverTime: NOW.toISOString(), activeTimers: [] });
		resolveWrite(confirmed);
		await write;

		expect(store.events).toEqual([confirmed]);
		expect(changes).toEqual([{ kind: 'reset' }, { kind: 'created', event: confirmed }]);
	});

	it('keeps one activity when SSE confirms the HTTP result again', async () => {
		const http = transport();
		const confirmed = diaper();
		vi.mocked(http.create).mockResolvedValue(confirmed);
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();

		await store.changes.create({
			babyId: 'baby-1',
			type: 'diaper',
			startedAt: NOW.toISOString(),
			details: { pee: true, poo: false }
		});
		adapter.change({ kind: 'created', event: confirmed, serverTime: NOW.toISOString() });

		expect(store.events).toEqual([confirmed]);
	});

	it('does not resurrect a deleted activity when its delayed create has the same timestamp', async () => {
		const http = transport();
		const confirmed = diaper();
		const deleted = diaper({ deletedAt: NOW.toISOString() });
		vi.mocked(http.create).mockResolvedValue(confirmed);
		vi.mocked(http.delete).mockResolvedValue(deleted);
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();

		await store.changes.create({
			babyId: 'baby-1',
			type: 'diaper',
			startedAt: NOW.toISOString(),
			details: { pee: true, poo: false }
		});
		await store.changes.delete(confirmed.id);
		adapter.change({ kind: 'created', event: confirmed, serverTime: NOW.toISOString() });

		expect(store.events).toEqual([]);
	});

	it('accepts a distinguishable same-timestamp SSE completion after an HTTP start', async () => {
		const http = transport();
		const running = diaper({ id: 'sleep-1', type: 'sleep', details: {}, endedAt: null });
		const completed = diaper({
			id: running.id,
			type: 'sleep',
			details: {},
			endedAt: NOW.toISOString()
		});
		vi.mocked(http.startTimer).mockResolvedValue({ created: true, event: running });
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();

		await store.changes.startTimer('sleep', { babyId: 'baby-1' });
		adapter.change({ kind: 'updated', event: completed, serverTime: NOW.toISOString() });

		expect(store.timers).toEqual([]);
		expect(store.events).toEqual([completed]);
	});

	it('accepts a same-timestamp SSE restore after an HTTP delete', async () => {
		const http = transport();
		const confirmed = diaper();
		const deleted = diaper({ deletedAt: NOW.toISOString() });
		vi.mocked(http.create).mockResolvedValue(confirmed);
		vi.mocked(http.delete).mockResolvedValue(deleted);
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();

		await store.changes.create({
			babyId: 'baby-1',
			type: 'diaper',
			startedAt: NOW.toISOString(),
			details: { pee: true, poo: false }
		});
		await store.changes.delete(confirmed.id);
		adapter.change({ kind: 'restored', event: confirmed, serverTime: NOW.toISOString() });

		expect(store.events).toEqual([confirmed]);
	});

	it('accepts a same-timestamp HTTP delete after an SSE restore', async () => {
		const http = transport();
		const confirmed = diaper();
		const deleted = diaper({ deletedAt: NOW.toISOString() });
		vi.mocked(http.delete).mockResolvedValue(deleted);
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();

		await store.changes.delete(confirmed.id);
		adapter.change({ kind: 'restored', event: confirmed, serverTime: NOW.toISOString() });
		await store.changes.delete(confirmed.id);

		expect(store.events).toEqual([]);
	});

	it('does not mistake an earlier identical SSE delete for a later HTTP delete echo', async () => {
		const http = transport();
		const confirmed = diaper();
		const deleted = diaper({ deletedAt: NOW.toISOString() });
		vi.mocked(http.delete).mockResolvedValue(deleted);
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();

		adapter.change({ kind: 'deleted', event: deleted, serverTime: NOW.toISOString() });
		adapter.change({ kind: 'restored', event: confirmed, serverTime: NOW.toISOString() });
		await store.changes.delete(confirmed.id);

		expect(store.events).toEqual([]);
	});

	it('keeps a newer SSE version when an older HTTP response arrives later', async () => {
		const http = transport();
		let resolveWrite!: (event: EventDTO) => void;
		vi.mocked(http.create).mockReturnValue(
			new Promise<EventDTO>((resolve) => {
				resolveWrite = resolve;
			})
		);
		const older = diaper({ note: 'older' });
		const newer = diaper({
			note: 'newer',
			updatedAt: new Date(NOW.getTime() + 1_000).toISOString()
		});
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();

		const write = store.changes.create({
			babyId: 'baby-1',
			type: 'diaper',
			startedAt: NOW.toISOString(),
			details: { pee: true, poo: false }
		});
		adapter.change({ kind: 'updated', event: newer, serverTime: NOW.toISOString() });
		resolveWrite(older);
		await write;

		expect(store.events).toEqual([newer]);
	});

	it('keeps a same-timestamp SSE completion when its HTTP start response arrives last', async () => {
		const http = transport();
		let resolveStart!: (result: { created: boolean; event: EventDTO }) => void;
		vi.mocked(http.startTimer).mockReturnValue(
			new Promise((resolve) => {
				resolveStart = resolve;
			})
		);
		const running = diaper({ id: 'sleep-1', type: 'sleep', details: {}, endedAt: null });
		const completed = diaper({
			id: running.id,
			type: 'sleep',
			details: {},
			endedAt: NOW.toISOString()
		});
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();

		const start = store.changes.startTimer('sleep', { babyId: 'baby-1' });
		adapter.change({ kind: 'updated', event: completed, serverTime: NOW.toISOString() });
		resolveStart({ created: true, event: running });
		await start;

		expect(store.timers).toEqual([]);
		expect(store.events).toEqual([completed]);
	});

	it('adopts an existing concurrent timer without fabricating a created publication', async () => {
		const http = transport();
		const existing = diaper({
			id: 'sleep-1',
			type: 'sleep',
			details: {},
			endedAt: null
		});
		vi.mocked(http.startTimer).mockResolvedValue({ created: false, event: existing });
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();
		const changes: unknown[] = [];
		store.subscribeChanges((change) => changes.push(change));

		const result = await store.changes.startTimer('sleep', {
			babyId: 'baby-1',
			caregiverId: 'caregiver-1'
		});

		expect(result).toEqual(existing);
		expect(store.timers).toEqual([existing]);
		expect(changes).toEqual([{ kind: 'adopted', event: existing }]);
	});

	it('reconciles a stopped timer into completed activity state', async () => {
		const http = transport();
		const running = diaper({ id: 'sleep-1', type: 'sleep', details: {}, endedAt: null });
		const completed = diaper({
			id: running.id,
			type: 'sleep',
			details: {},
			endedAt: new Date(NOW.getTime() + 60_000).toISOString(),
			updatedAt: new Date(NOW.getTime() + 60_000).toISOString()
		});
		vi.mocked(http.stopTimer).mockResolvedValue(completed);
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();
		adapter.change({ kind: 'created', event: running, serverTime: NOW.toISOString() });

		const result = await store.changes.stopTimer('sleep', { babyId: 'baby-1' });

		expect(result).toEqual(completed);
		expect(store.timers).toEqual([]);
		expect(store.events).toEqual([completed]);
	});

	it('reconciles nursing transitions and leaves state unchanged on failure', async () => {
		const http = transport();
		const updated = diaper({
			id: 'nursing-1',
			type: 'nursing',
			details: {
				segments: [
					{
						side: 'left',
						startedAt: NOW.toISOString(),
						endedAt: new Date(NOW.getTime() + 1_000).toISOString()
					}
				]
			},
			updatedAt: new Date(NOW.getTime() + 1_000).toISOString()
		});
		vi.mocked(http.nursingAction).mockResolvedValueOnce(updated).mockRejectedValueOnce(new Error('offline'));
		const store = syncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();

		await store.changes.nursingAction({ babyId: 'baby-1', action: 'pause' });
		expect(store.events).toEqual([updated]);

		await expect(
			store.changes.nursingAction({ babyId: 'baby-1', action: 'resume', side: 'left' })
		).rejects.toThrow('offline');
		expect(store.events).toEqual([updated]);
	});
});
