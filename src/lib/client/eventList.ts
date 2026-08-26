// Ordering and merge primitives shared by every client-side event list
// (SyncStore's today/timers lists, HistoryWindow's day/week windows). Kept in
// one module so "how do we fold an authoritative event into a list" has a
// single implementation: the `updatedAt` guard below is the only thing standing
// between an out-of-order response and a regressed list, and it must not exist
// in two divergent copies.
import type { EventDTO } from './types';

/** Newest first — the reading order of the Today screen. */
export function sortByStartedAtDesc(events: EventDTO[]): EventDTO[] {
	return [...events].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** Oldest first — the reading order of the History day list and calendar. */
export function sortByStartedAtAsc(events: EventDTO[]): EventDTO[] {
	return [...events].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/** Most recently deleted first — the reading order of the Recently-deleted
 * sheet. `updatedAt` is the fallback for a change whose tombstone has not been
 * materialized yet (a `deleted` kind carrying `deletedAt: null`). */
export function sortByDeletedAtDesc(events: EventDTO[]): EventDTO[] {
	return [...events].sort(
		(a, b) => Date.parse(b.deletedAt ?? b.updatedAt) - Date.parse(a.deletedAt ?? a.updatedAt)
	);
}

/**
 * Whether a confirmed change means "this event is deleted": either the change
 * kind itself says so, or the event carries a `deletedAt` tombstone. One
 * module decides (US-22, #74 — issue #88 finding 1); every list then only
 * chooses what deletion means for it (drop it from a live window, keep it in
 * the recently-deleted sheet).
 */
export function isDeletion(change: { kind: string; event: EventDTO }): boolean {
	return change.kind === 'deleted' || change.event.deletedAt !== null;
}

export type EventSort = (events: EventDTO[]) => EventDTO[];

/**
 * Insert/replace `event` when `keep`, otherwise remove it — but only if `event`
 * is not older (by `updatedAt`) than whatever is already stored for that id.
 * Makes every caller an idempotent, order-independent, last-write-wins upsert:
 * applying the same mutation twice, or two mutations out of order, never
 * duplicates or regresses the list. `sort` decides the resulting order, which
 * differs per screen.
 */
export function upsert(
	list: EventDTO[],
	event: EventDTO,
	keep: boolean,
	sort: EventSort
): EventDTO[] {
	const existing = list.find((e) => e.id === event.id);
	if (existing && Date.parse(event.updatedAt) < Date.parse(existing.updatedAt)) return list;
	const without = list.filter((e) => e.id !== event.id);
	return keep ? sort([...without, event]) : without;
}
