// The one overlapping-fetch guard shared by every client window (issue #88,
// finding 5): a supersede token plus the replay buffer of changes that landed
// while the fetch was in flight. Previously this {token, active, buffer}
// triple was hand-rolled in HistoryWindow (day/week/prevWeek), the
// RecentlyDeletedSheet and SyncStore's two refreshes; one implementation keeps
// the staleness rule ("only the latest run may commit, replaying what it
// missed") from drifting apart per screen.

/** Handle for one fetch run. `current` flips false the moment a newer run (or
 * an invalidate) supersedes this one — a superseded run must commit nothing. */
export type BufferedFetchRun<C> = {
	readonly current: boolean;
	/** Changes recorded while this run was in flight. Only meaningful while
	 * `current`: a superseded run reads the newer run's buffer. */
	readonly buffered: readonly C[];
	/** Ends the run if it is still the current one; returns whether it was, so
	 * a `finally` block can gate its own state resets on the answer. */
	end(): boolean;
};

export class BufferedFetch<C> {
	#token = 0;
	#active: number | null = null;
	#buffer: C[] = [];

	/** Starts a run, superseding any run still in flight. */
	begin(): BufferedFetchRun<C> {
		const token = ++this.#token;
		this.#active = token;
		this.#buffer = [];
		const owner = this;
		return {
			get current(): boolean {
				return token === owner.#token;
			},
			get buffered(): readonly C[] {
				return owner.#buffer;
			},
			end: () => {
				if (token !== this.#token) return false;
				this.#active = null;
				this.#buffer = [];
				return true;
			}
		};
	}

	/** True while the current run is awaiting its response. */
	get inFlight(): boolean {
		return this.#active === this.#token;
	}

	/** Buffers `change` for replay if a run is in flight, else drops it. */
	record(change: C): void {
		if (this.inFlight) this.#buffer.push(change);
	}

	/** Supersedes any in-flight run without starting a new one. */
	invalidate(): void {
		this.#token++;
		this.#active = null;
		this.#buffer = [];
	}
}
