// State machine behind the History screen (FR-006/007/009/010), extracted from
// `+page.svelte` on the SyncStore model so it can be unit-tested without a
// component harness. It owns the selected window (day key + day/week mode), the
// three fetches feeding it, the anti-race tokens guarding them, the skeleton
// timer and the direct-merge path used after a confirmed write. The page keeps
// only markup and purely presentational state (category chips, sheets, toasts).
import { ApiError, listBabies, listCaregivers, listEvents } from '$lib/client/api';
import { sortByStartedAtAsc, upsert } from '$lib/client/eventList';
import { dayRangeIso, eventOverlapsDay, localDayKey } from '$lib/client/summaries';
import type { RelayChange, SyncStore } from '$lib/client/sync.svelte';
import type { ConfirmedActivityChange } from '$lib/client/activityChanges';
import type { CaregiverDTO, EventDTO } from '$lib/client/types';

const LOAD_ERROR = 'Impossible de charger l’historique.';
/** Only show a skeleton once a load is slow enough to be noticed. */
const SKELETON_DELAY_MS = 300;

function messageOf(error: unknown): string {
	return error instanceof ApiError ? error.userMessage : LOAD_ERROR;
}

/** Local day key of the Monday starting the week `key` belongs to. */
export function mondayOf(key: string): string {
	const [y, m, d] = key.split('-').map(Number);
	const date = new Date(y, m - 1, d);
	const dow = date.getDay(); // 0 = Sun, 1 = Mon, …
	const diff = dow === 0 ? -6 : 1 - dow;
	return localDayKey(new Date(y, m - 1, d + diff));
}

export function prevMondayOf(key: string): string {
	const [y, m, d] = mondayOf(key).split('-').map(Number);
	return localDayKey(new Date(y, m - 1, d - 7));
}

/** The seven local days starting at `mondayKey`, as an ISO half-open range. */
function weekRangeIso(mondayKey: string): { from: string; to: string } {
	const { from } = dayRangeIso(mondayKey);
	const [y, m, d] = mondayKey.split('-').map(Number);
	return { from, to: new Date(y, m - 1, d + 7).toISOString() };
}

export class HistoryWindow {
	babyId = $state<string | null>(null);
	caregivers = $state<CaregiverDTO[]>([]);
	dayKey = $state('');
	viewMode = $state<'day' | 'week'>('day');
	dayEvents = $state<EventDTO[]>([]);
	weekEvents = $state<EventDTO[]>([]);
	/** null until it loads: the week-over-week block hides rather than comparing
	 * against zeros after a failed fetch. */
	prevWeekEvents = $state<EventDTO[] | null>(null);
	loading = $state(false);
	showSkeleton = $state(false);
	loadError = $state<string | null>(null);

	#sync: SyncStore;
	#unsubscribe: (() => void) | null = null;

	// Tokens (mirroring SyncStore's #generation) discard a stale response: with
	// manual-add/edit/delete, the SSE relay and every window change able to
	// trigger overlapping fetches, an earlier-issued-but-slower one must never be
	// allowed to resolve after and clobber a newer one's data. Incremental relay
	// reconciliation is the primary defense; these tokens guard concurrent loads.
	#dayFetchToken = 0;
	#weekFetchToken = 0;
	#prevWeekFetchToken = 0;
	#dayFetchActive: number | null = null;
	#weekFetchActive: number | null = null;
	#prevWeekFetchActive: number | null = null;
	#dayBuffer: ConfirmedActivityChange[] = [];
	#weekBuffer: ConfirmedActivityChange[] = [];
	#prevWeekBuffer: ConfirmedActivityChange[] = [];
	#weekLoaded = false;
	#prevWeekLoaded = false;

	constructor(sync: SyncStore) {
		this.#sync = sync;
		this.dayKey = this.todayKey;
	}

	/** Reactive, not a constant: `store.nowMs` ticks every second, so the picker
	 * stops labelling yesterday as "today" — and the next-day arrow stops being
	 * wrongly disabled — the moment local midnight passes, without a reload. */
	get todayKey(): string {
		return localDayKey(new Date(this.#sync.nowMs));
	}

	get nowMs(): number {
		return this.#sync.nowMs;
	}

	get mondayKey(): string {
		return mondayOf(this.dayKey);
	}

	get prevMondayKey(): string {
		return prevMondayOf(this.dayKey);
	}

	/**
	 * The day's events as listed, oldest first. Overlap, not starts-in-day: a
	 * carry-over session (e.g. sleep 23:30→01:30) stays visible on both the day it
	 * started and the day it ended — `dailySummary`'s counts still attribute it to
	 * the start day only, so this changes what is listed, not what is counted.
	 */
	get visibleDayEvents(): EventDTO[] {
		return sortByStartedAtAsc(
			this.dayEvents.filter(
				(e) => e.deletedAt === null && eventOverlapsDay(e, this.dayKey, this.nowMs)
			)
		);
	}

	/**
	 * Subscribes to the change relay, then resolves the baby and starts the sync
	 * store. The order matters: `SyncStore.start()` resets its transport, and only
	 * a full `stop()` clears listeners — subscribing first is what lets a listener
	 * registered before the baby id resolves survive that reset.
	 */
	start(): void {
		this.#unsubscribe = this.#sync.subscribeChanges((change) => this.#receive(change));
		void this.#loadContext();
	}

	stop(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
	}

	async #loadContext(): Promise<void> {
		try {
			const babies = await listBabies();
			const baby = babies[0];
			if (baby) {
				this.babyId = baby.id;
				this.#sync.start(baby.id);
				this.#refetchCurrentView();
			}
			this.caregivers = await listCaregivers();
		} catch (e) {
			this.loadError = messageOf(e);
		}
	}

	setDayKey(next: string): void {
		if (next === this.dayKey) return;
		this.dayKey = next;
		this.#refetchCurrentView();
	}

	/** Switching to 'week' loads the week windows; switching back to 'day' needs
	 * no fetch — the day window was never dropped. */
	setViewMode(mode: 'day' | 'week'): void {
		if (mode === this.viewMode) return;
		this.viewMode = mode;
		if (mode === 'week') {
			void this.loadWeek();
			void this.loadPrevWeek();
		}
	}

	/** Picking a day inside the week view zooms into it. */
	selectWeekDay(nextDayKey: string): void {
		const changed = nextDayKey !== this.dayKey;
		this.dayKey = nextDayKey;
		this.viewMode = 'day';
		if (changed) void this.loadDay();
	}

	#refetchCurrentView(): void {
		void this.loadDay();
		if (this.viewMode === 'week') {
			void this.loadWeek();
			void this.loadPrevWeek();
		}
	}

	async loadDay(): Promise<void> {
		if (this.babyId === null) return;
		const token = ++this.#dayFetchToken;
		this.#dayFetchActive = token;
		this.#dayBuffer = [];
		this.loading = true;
		this.loadError = null;
		// A per-call timer (not a shared instance field): with two loadDay() calls
		// overlapping, a shared timer let one call's finally{} clear the *other*
		// call's timeout, leaving the first one's orphaned and firing later —
		// flipping showSkeleton back on for good and hiding an already up-to-date,
		// correctly merged list behind the skeleton forever. The callback also
		// re-checks the token, so a stale call's timer (even if it fires before
		// being cleared) can never touch state a newer call already owns.
		const skeletonTimer = setTimeout(() => {
			if (token === this.#dayFetchToken) this.showSkeleton = true;
		}, SKELETON_DELAY_MS);
		try {
			const { from, to } = dayRangeIso(this.dayKey);
			const fetched = await listEvents(this.babyId, from, to, true);
			if (token !== this.#dayFetchToken) return; // superseded by a newer load
			let merged = sortByStartedAtAsc(fetched);
			for (const change of this.#dayBuffer) merged = this.#applyToDay(merged, change);
			this.dayEvents = merged;
		} catch (e) {
			if (token !== this.#dayFetchToken) return;
			this.loadError = messageOf(e);
		} finally {
			clearTimeout(skeletonTimer);
			if (token === this.#dayFetchToken) {
				this.#dayFetchActive = null;
				this.#dayBuffer = [];
				this.loading = false;
				this.showSkeleton = false;
			}
		}
	}

	async loadWeek(): Promise<void> {
		if (this.babyId === null) return;
		const token = ++this.#weekFetchToken;
		this.#weekFetchActive = token;
		this.#weekBuffer = [];
		try {
			const { from, to } = weekRangeIso(this.mondayKey);
			const fetched = await listEvents(this.babyId, from, to, true);
			if (token !== this.#weekFetchToken) return; // superseded by a newer load
			let merged = sortByStartedAtAsc(fetched);
			for (const change of this.#weekBuffer) merged = this.#applyToWeek(merged, change, this.mondayKey);
			this.weekEvents = merged;
			this.#weekLoaded = true;
		} catch (e) {
			if (token !== this.#weekFetchToken) return;
			this.loadError = messageOf(e);
		} finally {
			if (token === this.#weekFetchToken) {
				this.#weekFetchActive = null;
				this.#weekBuffer = [];
			}
		}
	}

	/** Same race guard as loadWeek, with its own token. A failure stays silent:
	 * the comparison is an extra, not the screen. */
	async loadPrevWeek(): Promise<void> {
		if (this.babyId === null) return;
		const token = ++this.#prevWeekFetchToken;
		this.#prevWeekFetchActive = token;
		this.#prevWeekBuffer = [];
		this.#prevWeekLoaded = false;
		// Hide the comparison while the new window loads: keeping the old week's
		// events would summarize them against the new date range (stale deltas).
		this.prevWeekEvents = null;
		try {
			const { from, to } = weekRangeIso(this.prevMondayKey);
			const fetched = await listEvents(this.babyId, from, to, true);
			if (token !== this.#prevWeekFetchToken) return; // superseded by a newer load
			let merged = sortByStartedAtAsc(fetched);
			for (const change of this.#prevWeekBuffer)
				merged = this.#applyToWeek(merged, change, this.prevMondayKey);
			this.prevWeekEvents = merged;
			this.#prevWeekLoaded = true;
		} catch {
			if (token !== this.#prevWeekFetchToken) return;
			this.prevWeekEvents = null;
		} finally {
			if (token === this.#prevWeekFetchToken) {
				this.#prevWeekFetchActive = null;
				this.#prevWeekBuffer = [];
			}
		}
	}

	#receive(change: RelayChange): void {
		if (change.kind === 'reset') {
			this.#refetchCurrentView();
			return;
		}
		if (this.babyId !== null && change.event.babyId !== this.babyId) return;

		this.dayEvents = this.#applyToDay(this.dayEvents, change);
		if (this.#dayFetchActive === this.#dayFetchToken) this.#dayBuffer.push(change);

		if (this.viewMode === 'week' || this.#weekLoaded) {
			this.weekEvents = this.#applyToWeek(this.weekEvents, change, this.mondayKey);
			if (this.#weekFetchActive === this.#weekFetchToken) this.#weekBuffer.push(change);
		}

		if (this.#prevWeekFetchActive === this.#prevWeekFetchToken) {
			this.#prevWeekBuffer.push(change);
		} else if (this.#prevWeekLoaded) {
			// Only a successfully loaded baseline may be patched: after a failed
			// load, prevWeekEvents stays null so the comparison stays hidden.
			this.prevWeekEvents = this.#applyToWeek(
				this.prevWeekEvents ?? [],
				change,
				this.prevMondayKey
			);
		}
	}

	#applyToDay(list: EventDTO[], change: ConfirmedActivityChange): EventDTO[] {
		const gone = change.kind === 'deleted' || change.event.deletedAt !== null;
		return upsert(
			list,
			change.event,
			!gone && eventOverlapsDay(change.event, this.dayKey, this.nowMs),
			sortByStartedAtAsc
		);
	}

	#applyToWeek(
		list: EventDTO[],
		change: ConfirmedActivityChange,
		mondayKey: string
	): EventDTO[] {
		const gone = change.kind === 'deleted' || change.event.deletedAt !== null;
		return upsert(
			list,
			change.event,
			!gone && this.#overlapsWeek(change.event, mondayKey),
			sortByStartedAtAsc
		);
	}

	#overlapsWeek(event: EventDTO, mondayKey: string): boolean {
		const [year, month, day] = mondayKey.split('-').map(Number);
		for (let offset = 0; offset < 7; offset++) {
			const key = localDayKey(new Date(year, month - 1, day + offset));
			if (eventOverlapsDay(event, key, this.nowMs)) return true;
		}
		return false;
	}

}
