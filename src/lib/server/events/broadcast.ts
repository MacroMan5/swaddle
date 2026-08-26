import type { BabyDTO, EventDTO } from './types';

export type Change =
	| { kind: 'created' | 'updated' | 'deleted' | 'restored'; event: EventDTO }
	| { kind: 'reset' }
	| { kind: 'baby'; baby: BabyDTO };

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

/**
 * A restore replaces the entire dataset out from under any connected client:
 * unlike a normal create/update/delete/restore, there is no single EventDTO
 * to describe the change. Subscribers must refetch timers and lists instead.
 */
export function publishReset(): void {
	publish({ kind: 'reset' });
}

/** #46: a baby's name/birthdate was corrected — connected clients (e.g. a
 * Today screen already open on another device) must refresh what they show
 * for it instead of waiting for a reload. */
export function publishBabyUpdated(baby: BabyDTO): void {
	publish({ kind: 'baby', baby });
}
