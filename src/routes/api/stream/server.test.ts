import { describe, it, expect, vi, afterEach } from 'vitest';
import { listenerCount, publish } from '$lib/server/events/broadcast';
import type { EventDTO } from '$lib/server/events/types';

// The handler only needs the DB to read active timers; keep the test off disk.
vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('$lib/server/events/repo', () => ({ listActiveTimers: () => [] }));

const { GET } = await import('./+server');

afterEach(() => {
	vi.useRealTimers();
});

async function openStream() {
	const response = await GET({} as never);
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	const next = async () => decoder.decode((await reader.read()).value, { stream: true });
	return { response, reader, next };
}

describe('GET /api/stream', () => {
	it('sends a snapshot, then a sync per change', async () => {
		const { response, reader, next } = await openStream();
		expect(response.headers.get('content-type')).toBe('text/event-stream');

		const snapshot = await next();
		expect(snapshot).toContain('event: snapshot');
		expect(snapshot).toContain('"activeTimers":[]');
		expect(snapshot).toContain('"serverTime"');

		publish({ kind: 'created', event: { id: 'e1' } as EventDTO });
		const sync = await next();
		expect(sync).toContain('event: sync');
		expect(sync).toContain('"kind":"created"');
		expect(sync).toContain('"serverTime"');

		await reader.cancel();
	});

	it('emits a :ping heartbeat every 25 s', async () => {
		vi.useFakeTimers();
		const { reader, next } = await openStream();
		await next(); // snapshot

		vi.advanceTimersByTime(25_000);
		expect(await next()).toBe(':ping\n\n');
		vi.advanceTimersByTime(25_000);
		expect(await next()).toBe(':ping\n\n');

		await reader.cancel();
	});

	it('unsubscribes and clears the heartbeat on cancel', async () => {
		vi.useFakeTimers();
		const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
		const before = listenerCount();

		const { reader, next } = await openStream();
		await next(); // snapshot
		expect(listenerCount()).toBe(before + 1);

		await reader.cancel();

		expect(listenerCount()).toBe(before);
		expect(clearIntervalSpy).toHaveBeenCalled();
		// A change published after cancel reaches nobody and throws nothing.
		expect(() => publish({ kind: 'updated', event: { id: 'e2' } as EventDTO })).not.toThrow();
		clearIntervalSpy.mockRestore();
	});
});
