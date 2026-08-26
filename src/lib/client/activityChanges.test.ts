import { describe, expect, it, vi } from 'vitest';
import { SyncStore } from './sync.svelte';
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
		delete: vi.fn()
	};
}

describe('activity changes', () => {
	it('records a confirmed diaper in authoritative local state', async () => {
		const http = transport();
		const confirmed = diaper();
		vi.mocked(http.create).mockResolvedValue(confirmed);
		const store = new SyncStore(http);
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
		const store = new SyncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();
		store.applyServerEvent(existing);
		const changes: unknown[] = [];
		store.subscribeChanges((change) => changes.push(change));

		const result = await store.changes.delete(existing.id);

		expect(result).toEqual(deleted);
		expect(store.events).toEqual([]);
		expect(changes).toEqual([{ kind: 'deleted', event: deleted }]);
	});

	it('does not change or announce local state when the write fails', async () => {
		const http = transport();
		vi.mocked(http.create).mockRejectedValue(new Error('offline'));
		const store = new SyncStore(http);
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

	it('keeps one activity when SSE confirms the HTTP result again', async () => {
		const http = transport();
		const confirmed = diaper();
		vi.mocked(http.create).mockResolvedValue(confirmed);
		const store = new SyncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();

		await store.changes.create({
			babyId: 'baby-1',
			type: 'diaper',
			startedAt: NOW.toISOString(),
			details: { pee: true, poo: false }
		});
		store.applyChange({ kind: 'created', event: confirmed, serverTime: NOW.toISOString() });

		expect(store.events).toEqual([confirmed]);
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
		const store = new SyncStore(http);
		store.babyId = 'baby-1';
		store.nowMs = NOW.getTime();

		const write = store.changes.create({
			babyId: 'baby-1',
			type: 'diaper',
			startedAt: NOW.toISOString(),
			details: { pee: true, poo: false }
		});
		store.applyChange({ kind: 'updated', event: newer, serverTime: NOW.toISOString() });
		resolveWrite(older);
		await write;

		expect(store.events).toEqual([newer]);
	});
});
