import { getTimers, listTodayEvents } from './api';
import { isNewLocalDay } from './format';
import { eventOverlapsDay, localDayKey } from './summaries';
import { isTimerType } from './types';
import type { EventDTO, SnapshotMessage, SyncKind, SyncMessage } from './types';

/** A change relayed to non-today views. A `sync` message carries `event`; a
 * snapshot/reset (reconnect or data restore) has no single event to apply
 * incrementally and signals "refetch your window" instead. */
export type RelayChange = { kind: SyncKind; event: EventDTO } | { kind: 'reset' };

const browser = typeof window !== 'undefined';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

function isActiveTimer(event: EventDTO): boolean {
	return event.deletedAt === null && event.endedAt === null && isTimerType(event.type);
}

/**
 * Single source of client truth for the Today screen: today's events, the active
 * timers, the connection state and the server-time offset (RISK-001). DOM access
 * stays behind `browser`, so the state transitions below are unit-testable.
 */
export class SyncStore {
	events = $state<EventDTO[]>([]);
	timers = $state<EventDTO[]>([]);
	/** 'connecting' until the first open/error, then tracks the live SSE link. */
	connectionState = $state<ConnectionState>('connecting');
	serverOffsetMs = $state(0);
	nowMs = $state(Date.now());
	babyId: string | null = null;

	#source: EventSource | null = null;
	#tick: ReturnType<typeof setInterval> | null = null;
	#alive = false;
	/**
	 * Bumped only by start()/stop() — identifies "this run" of the store. An
	 * in-flight refreshEvents/refreshTimers snapshots it before the async fetch
	 * and discards the response if it no longer matches, so a stale fetch never
	 * lands after the store has been stopped or restarted for another baby.
	 * Concurrent SSE/HTTP changes are handled separately below (buffering), not
	 * by this counter, so events and timers no longer invalidate each other.
	 */
	#generation = 0;

	/** Changes applied while the matching refresh is in flight, replayed onto the
	 * fetched baseline once it lands so neither side loses information. */
	#eventsRefreshing = false;
	#eventsBuffer: { event: EventDTO; deleted: boolean }[] = [];
	#timersRefreshing = false;
	#timersBuffer: { event: EventDTO; deleted: boolean }[] = [];

	/** Listeners for non-today views (history) that need to react to changes
	 * outside today's window, which `events`/`timers` never carry. */
	#changeListeners = new Set<(change: RelayChange) => void>();

	/** Idempotent: a repeated start() for the same baby (e.g. a remounted page) is a no-op. */
	start(babyId: string): void {
		if (this.#alive && this.babyId === babyId) return;
		// Transport-only reset: a caller (e.g. history's onMount) may have called
		// subscribeChanges() before awaiting the baby id and calling start() —
		// even a *first* start() reaches this branch (#alive starts false) — so
		// that subscription must survive. Only the full stop() below clears
		// #changeListeners, for real teardown (+layout.svelte's onDestroy).
		this.#stopTransport();
		this.babyId = babyId;
		this.#alive = true;
		this.#generation++;
		this.nowMs = Date.now() + this.serverOffsetMs;
		if (!browser) return;

		void this.refreshEvents();
		this.#tick = setInterval(() => this.tick(), 1000);

		const source = new EventSource('/api/stream');
		this.#source = source;
		source.addEventListener('open', () => this.handleOpen());
		source.addEventListener('error', () => this.handleError());
		source.addEventListener('snapshot', (e) =>
			this.applySnapshot(JSON.parse((e as MessageEvent).data) as SnapshotMessage)
		);
		source.addEventListener('sync', (e) =>
			this.applyChange(JSON.parse((e as MessageEvent).data) as SyncMessage)
		);
		// `reset` is emitted after a data restore (slice 5); older servers never send
		// it, so this listener is simply inert until then (no feature detection
		// needed).
		source.addEventListener('reset', (e) =>
			this.applyReset(JSON.parse((e as MessageEvent).data) as { serverTime: string })
		);
	}

	stop(): void {
		this.#stopTransport();
		this.#changeListeners.clear();
	}

	#stopTransport(): void {
		this.#alive = false;
		this.#generation++;
		if (this.#tick !== null) clearInterval(this.#tick);
		this.#tick = null;
		this.#source?.close();
		this.#source = null;
	}

	/**
	 * Change relay for non-today views (history): invoked for every applied
	 * `sync` message, and once with `{ kind: 'reset' }` on a snapshot or an
	 * `applyReset` (reconnect/restore) — those don't carry a single event a
	 * listener could apply incrementally, so they signal "refetch your window"
	 * instead. Listener errors are swallowed so one bad subscriber never breaks
	 * another, or the caller that triggered the change.
	 */
	subscribeChanges(fn: (change: RelayChange) => void): () => void {
		this.#changeListeners.add(fn);
		return () => this.#changeListeners.delete(fn);
	}

	#emitChange(change: RelayChange): void {
		for (const fn of this.#changeListeners) {
			try {
				fn(change);
			} catch {
				// A listener's own error must not break other listeners or the caller.
			}
		}
	}

	handleOpen(): void {
		this.connectionState = 'connected';
	}

	/** EventSource reconnects on its own; a new snapshot restores state (FR-012). */
	handleError(): void {
		this.connectionState = 'disconnected';
	}

	/**
	 * Advances the corrected clock and refreshes today's events across a local
	 * midnight rollover (item 3). A plain method (not wired only through
	 * setInterval) so it stays unit-testable without a real timer.
	 */
	tick(): void {
		const prev = this.nowMs;
		this.nowMs = Date.now() + this.serverOffsetMs;
		// Update nowMs first: a rollover refresh must query with the new day, not the old one.
		if (isNewLocalDay(prev, this.nowMs)) void this.refreshEvents();
	}

	/**
	 * Fetches today's events and replaces the list — but first replays onto that
	 * fetched baseline any change that arrived (via applyServerEvent/applyChange)
	 * while this fetch was in flight, so a `sync` racing an initial/snapshot
	 * refresh is never lost (item 1). Independent of refreshTimers: a reset's two
	 * refreshes no longer invalidate each other (item 2).
	 */
	async refreshEvents(): Promise<void> {
		if (this.babyId === null) return;
		const generation = this.#generation;
		this.#eventsRefreshing = true;
		this.#eventsBuffer = [];
		const fetched = await listTodayEvents(this.babyId, new Date(this.nowMs));
		this.#eventsRefreshing = false;
		if (generation !== this.#generation) {
			this.#eventsBuffer = [];
			return; // stopped, or restarted for another baby, meanwhile
		}
		let merged = sortByStartedAtDesc(fetched);
		for (const { event, deleted } of this.#eventsBuffer) {
			const gone = deleted || event.deletedAt !== null;
			merged = upsert(merged, event, !gone && this.#isToday(event));
		}
		this.#eventsBuffer = [];
		this.events = merged;
	}

	async refreshTimers(): Promise<void> {
		if (this.babyId === null) return;
		const generation = this.#generation;
		this.#timersRefreshing = true;
		this.#timersBuffer = [];
		const { timers } = await getTimers(this.babyId);
		this.#timersRefreshing = false;
		if (generation !== this.#generation) {
			this.#timersBuffer = [];
			return;
		}
		let merged = timers.filter((t) => this.#isMine(t));
		for (const { event, deleted } of this.#timersBuffer) {
			const gone = deleted || event.deletedAt !== null;
			merged = upsert(merged, event, !gone && isActiveTimer(event));
		}
		this.#timersBuffer = [];
		this.timers = merged;
	}

	applySnapshot(message: SnapshotMessage): void {
		this.#setServerTime(message.serverTime);
		this.connectionState = 'connected';
		this.#setTimers(message.activeTimers.filter((t) => this.#isMine(t)));
		if (browser) void this.refreshEvents();
		this.#emitChange({ kind: 'reset' });
	}

	/** A restore invalidates every id, so treat it like a fresh snapshot (FR-012). */
	applyReset(message: { serverTime: string }): void {
		this.#setServerTime(message.serverTime);
		if (browser) {
			void this.refreshEvents();
			void this.refreshTimers();
		}
		this.#emitChange({ kind: 'reset' });
	}

	applyChange(message: SyncMessage): void {
		this.#setServerTime(message.serverTime);
		this.applyServerEvent(message.event, message.kind === 'deleted');
		this.#emitChange({ kind: message.kind, event: message.event });
	}

	/**
	 * Merges one authoritative event (from an SSE `sync` message, or straight from
	 * an HTTP response) into `events`/`timers`. Idempotent and order-independent:
	 * `upsert` below ignores anything older than what is already stored by
	 * `updatedAt`, so applying the same mutation twice — via SSE and via the HTTP
	 * response, in either order — never duplicates or regresses state (item 5).
	 * UI call sites use this directly after a write so the screen is correct even
	 * with the SSE connection down (item 6).
	 */
	applyServerEvent(event: EventDTO, deleted = false): void {
		if (!this.#isMine(event)) return;
		const gone = deleted || event.deletedAt !== null;
		this.#setEvents(upsert(this.events, event, !gone && this.#isToday(event)));
		this.#setTimers(upsert(this.timers, event, !gone && isActiveTimer(event)));
		// A refresh in flight fetched its baseline before this change landed —
		// buffer it for replay when that fetch resolves (item 1).
		if (this.#eventsRefreshing) this.#eventsBuffer.push({ event, deleted });
		if (this.#timersRefreshing) this.#timersBuffer.push({ event, deleted });
	}

	#isMine(event: EventDTO): boolean {
		return this.babyId === null || event.babyId === this.babyId;
	}

	/**
	 * Whether `event` overlaps today's window (review item 1), not merely
	 * starts in it — otherwise a nursing/sleep session begun before local
	 * midnight (still running, or completed after midnight) would contribute
	 * nothing to Today's summary. Delegates to the same predicate the History
	 * day view uses (`eventOverlapsDay`), so "does this event belong to this
	 * local day" has one implementation, not two that could drift apart.
	 */
	#isToday(event: EventDTO): boolean {
		return eventOverlapsDay(event, localDayKey(new Date(this.nowMs)), this.nowMs);
	}

	#setServerTime(serverTime: string): void {
		this.serverOffsetMs = Date.parse(serverTime) - Date.now();
		this.nowMs = Date.now() + this.serverOffsetMs;
	}

	#setEvents(list: EventDTO[]): void {
		this.events = list;
	}

	#setTimers(list: EventDTO[]): void {
		this.timers = list;
	}
}

function sortByStartedAtDesc(events: EventDTO[]): EventDTO[] {
	return [...events].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/**
 * Insert/replace `event` when `keep`, otherwise remove it — but only if `event`
 * is not older (by `updatedAt`) than whatever is already stored for that id.
 * Makes every caller an idempotent, order-independent, last-write-wins upsert
 * (item 5): applying the same mutation twice, or two mutations out of order,
 * never duplicates or regresses the list.
 */
function upsert(list: EventDTO[], event: EventDTO, keep: boolean): EventDTO[] {
	const existing = list.find((e) => e.id === event.id);
	if (existing && Date.parse(event.updatedAt) < Date.parse(existing.updatedAt)) return list;
	const without = list.filter((e) => e.id !== event.id);
	return keep ? sortByStartedAtDesc([...without, event]) : without;
}
