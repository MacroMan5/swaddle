import type { EventDTO } from './types';

export type Change = {
	kind: 'created' | 'updated' | 'deleted' | 'restored';
	event: EventDTO;
};

type Listener = (change: Change) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Number of live subscribers — lets callers assert that a stream cleaned up. */
export function listenerCount(): number {
	return listeners.size;
}

export function publish(change: Change): void {
	for (const listener of [...listeners]) {
		try {
			listener(change);
		} catch {
			// A broken SSE consumer must not affect the others.
		}
	}
}
