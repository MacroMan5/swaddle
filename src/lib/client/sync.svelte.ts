import { getTimers, listTodayEvents } from './api';
import { todayRangeIso } from './format';
import type { EventDTO, SnapshotMessage, SyncMessage, TimerType } from './types';

const TIMER_TYPES: readonly TimerType[] = ['nursing', 'pump', 'sleep'];

const browser = typeof window !== 'undefined';

function isActiveTimer(event: EventDTO): boolean {
	return (
		event.deletedAt === null &&
		event.endedAt === null &&
		TIMER_TYPES.includes(event.type as TimerType)
	);
}

/**
 * Single source of client truth for the Today screen: today's events, the active
 * timers, the connection state and the server-time offset (RISK-001). DOM access
 * stays behind `browser`, so the state transitions below are unit-testable.
 */
export class SyncStore {
	events = $state<EventDTO[]>([]);
	timers = $state<EventDTO[]>([]);
	connected = $state(false);
	/** True once a first snapshot arrived: a loss is only reportable after that. */
	everConnected = $state(false);
	serverOffsetMs = $state(0);
	nowMs = $state(Date.now());
	babyId: string | null = null;

	#source: EventSource | null = null;
	#tick: ReturnType<typeof setInterval> | null = null;

	start(babyId: string): void {
		this.babyId = babyId;
		this.nowMs = Date.now() + this.serverOffsetMs;
		if (!browser) return;

		void this.refreshEvents();
		this.#tick = setInterval(() => {
			this.nowMs = Date.now() + this.serverOffsetMs;
		}, 1000);

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
		if (this.#tick !== null) clearInterval(this.#tick);
		this.#tick = null;
		this.#source?.close();
		this.#source = null;
	}

	handleOpen(): void {
		this.connected = true;
	}

	/** EventSource reconnects on its own; a new snapshot restores state (FR-012). */
	handleError(): void {
		this.connected = false;
	}

	async refreshEvents(): Promise<void> {
		if (this.babyId === null) return;
		this.events = sortByStartedAtDesc(await listTodayEvents(this.babyId));
	}

	applySnapshot(message: SnapshotMessage): void {
		this.#setServerTime(message.serverTime);
		this.connected = true;
		this.everConnected = true;
		this.timers = message.activeTimers.filter((t) => this.#isMine(t));
		if (browser) void this.refreshEvents();
	}

	/** A restore invalidates every id, so treat it like a fresh snapshot (FR-012). */
	applyReset(message: { serverTime: string }): void {
		this.#setServerTime(message.serverTime);
		if (browser) {
			void this.refreshEvents();
			void this.refreshTimers();
		}
	}

	async refreshTimers(): Promise<void> {
		if (this.babyId === null) return;
		const { timers } = await getTimers(this.babyId);
		this.timers = timers.filter((t) => this.#isMine(t));
	}

	applyChange(message: SyncMessage): void {
		this.#setServerTime(message.serverTime);
		const event = message.event;
		if (!this.#isMine(event)) return;

		const gone = message.kind === 'deleted' || event.deletedAt !== null;
		this.events = upsert(this.events, event, !gone && this.#isToday(event));
		this.timers = upsert(this.timers, event, !gone && isActiveTimer(event));
	}

	#isMine(event: EventDTO): boolean {
		return this.babyId === null || event.babyId === this.babyId;
	}

	#isToday(event: EventDTO): boolean {
		const { from, to } = todayRangeIso(new Date(this.nowMs));
		const at = Date.parse(event.startedAt);
		return at >= Date.parse(from) && at < Date.parse(to);
	}

	#setServerTime(serverTime: string): void {
		this.serverOffsetMs = Date.parse(serverTime) - Date.now();
		this.nowMs = Date.now() + this.serverOffsetMs;
	}
}

function sortByStartedAtDesc(events: EventDTO[]): EventDTO[] {
	return [...events].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** Insert/replace `event` when `keep`, otherwise remove it from the list. */
function upsert(list: EventDTO[], event: EventDTO, keep: boolean): EventDTO[] {
	const without = list.filter((e) => e.id !== event.id);
	return keep ? sortByStartedAtDesc([...without, event]) : without;
}
