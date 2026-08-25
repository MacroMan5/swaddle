<script lang="ts">
	// Historique (FR-009/FR-010): day selector, chronological list, category
	// filters and the day summary. Week view and editing arrive in later tasks
	// of the same slice.
	import { getContext, onDestroy, onMount } from 'svelte';
	import { Plus } from '@lucide/svelte';
	import { ApiError, listBabies, listCaregivers, listEvents } from '$lib/client/api';
	import { dayRangeIso, eventOverlapsDay, localDayKey } from '$lib/client/summaries';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import type { CaregiverDTO, EventDTO } from '$lib/client/types';
	import { CATEGORY_OF, type Category } from '$lib/components/today/todayDerivations';
	import DaySelector from '$lib/components/history/DaySelector.svelte';
	import DayCalendar from '$lib/components/history/DayCalendar.svelte';
	import EventEditSheet from '$lib/components/history/EventEditSheet.svelte';
	import { manualAddDefaultTime } from '$lib/components/history/eventForm';
	import EventList from '$lib/components/history/EventList.svelte';
	import { removeById, upsertById } from '$lib/components/history/historyList';
	import ManualAddSheet from '$lib/components/history/ManualAddSheet.svelte';
	import UndoToast from '$lib/components/UndoToast.svelte';
	import WeekView from '$lib/components/history/WeekView.svelte';

	const store = getContext<SyncStore>('sync');

	// Tailwind needs literal class names at build time (no `bg-${x}-700` templating).
	const CHIPS: { key: Category; label: string; barClass: string }[] = [
		{ key: 'feed', label: 'Alimentation', barClass: 'bg-feed-700' },
		{ key: 'diaper', label: 'Couche', barClass: 'bg-diaper-700' },
		{ key: 'sleep', label: 'Sommeil', barClass: 'bg-sleep-700' }
	];

	// Reactive, not a constant (review P2): store.nowMs ticks every second
	// (SyncStore.tick()), so this must too, or the picker keeps labelling
	// yesterday as "today" — and the next-day arrow stays wrongly disabled —
	// until the page is reloaded after local midnight.
	const todayKey = $derived(localDayKey(new Date(store.nowMs)));

	function mondayOf(key: string): string {
		const [y, m, d] = key.split('-').map(Number);
		const date = new Date(y, m - 1, d);
		const dow = date.getDay(); // 0 = Sun, 1 = Mon, …
		const diff = dow === 0 ? -6 : 1 - dow;
		return localDayKey(new Date(y, m - 1, d + diff));
	}

	let babyId = $state<string | null>(null);
	let caregivers = $state<CaregiverDTO[]>([]);
	let dayKey = $state(todayKey);
	let viewMode = $state<'day' | 'week'>('day');
	let selectedCategories = $state<Set<Category>>(new Set(['feed', 'diaper', 'sleep']));
	let dayEvents = $state<EventDTO[]>([]);
	let weekEvents = $state<EventDTO[]>([]);
	// null until it loads: the week-over-week block hides rather than comparing
	// against zeros after a failed fetch.
	let prevWeekEvents = $state<EventDTO[] | null>(null);
	let loading = $state(false);
	let showSkeleton = $state(false);
	let loadError = $state<string | null>(null);
	let unsubscribe: (() => void) | null = null;

	// Tokens (mirroring SyncStore's #generation) discard a stale response: with
	// manual-add/edit/delete, the SSE relay and the day/week effects all able to
	// trigger overlapping fetches, an earlier-issued-but-slower one must never
	// be allowed to resolve after and clobber a newer one's data (the CI race
	// behind #19's history-edit flake — see historyList.ts for the companion
	// direct-merge fix, which is the primary defense; this token guard is
	// defense in depth against any *other* concurrent refetch still winning).
	let dayFetchToken = 0;
	let weekFetchToken = 0;
	let prevWeekFetchToken = 0;

	async function loadDay(): Promise<void> {
		if (babyId === null) return;
		const token = ++dayFetchToken;
		loading = true;
		loadError = null;
		// A per-call timer (not a shared instance variable): with two loadDay()
		// calls overlapping, a shared timer let one call's finally{} clear the
		// *other* call's timeout, leaving the first one's orphaned and firing
		// later — flipping showSkeleton back on for good and hiding an already
		// up-to-date, correctly merged list behind the skeleton forever. The
		// callback itself also re-checks the token, so a stale call's timer
		// (even if it does fire before being cleared) can never touch state a
		// newer call already owns.
		const skeletonTimer = setTimeout(() => {
			if (token === dayFetchToken) showSkeleton = true;
		}, 300);
		try {
			const { from, to } = dayRangeIso(dayKey);
			const fetched = await listEvents(babyId, from, to, true);
			if (token !== dayFetchToken) return; // superseded by a newer load
			dayEvents = fetched;
		} catch (e) {
			if (token !== dayFetchToken) return;
			loadError = e instanceof ApiError ? e.userMessage : 'Impossible de charger l’historique.';
		} finally {
			clearTimeout(skeletonTimer);
			if (token === dayFetchToken) {
				loading = false;
				showSkeleton = false;
			}
		}
	}

	async function loadWeek(): Promise<void> {
		if (babyId === null) return;
		const token = ++weekFetchToken;
		try {
			const monday = mondayOf(dayKey);
			const { from } = dayRangeIso(monday);
			const [y, m, d] = monday.split('-').map(Number);
			const to = new Date(y, m - 1, d + 7).toISOString();
			const fetched = await listEvents(babyId, from, to, true);
			if (token !== weekFetchToken) return; // superseded by a newer load
			weekEvents = fetched;
		} catch (e) {
			if (token !== weekFetchToken) return;
			loadError = e instanceof ApiError ? e.userMessage : 'Impossible de charger l’historique.';
		}
	}

	function prevMondayOf(key: string): string {
		const [y, m, d] = mondayOf(key).split('-').map(Number);
		return localDayKey(new Date(y, m - 1, d - 7));
	}

	// Same race guard as loadWeek, with its own token. A failure stays silent:
	// the comparison is an extra, not the screen.
	async function loadPrevWeek(): Promise<void> {
		if (babyId === null) return;
		const token = ++prevWeekFetchToken;
		// Hide the comparison while the new window loads: keeping the old week's
		// events would summarize them against the new date range (stale deltas).
		prevWeekEvents = null;
		try {
			const monday = prevMondayOf(dayKey);
			const { from } = dayRangeIso(monday);
			const [y, m, d] = monday.split('-').map(Number);
			const to = new Date(y, m - 1, d + 7).toISOString();
			const fetched = await listEvents(babyId, from, to, true);
			if (token !== prevWeekFetchToken) return; // superseded by a newer load
			prevWeekEvents = fetched;
		} catch {
			if (token !== prevWeekFetchToken) return;
			prevWeekEvents = null;
		}
	}

	function refetchCurrentView(): void {
		void loadDay();
		if (viewMode === 'week') {
			void loadWeek();
			void loadPrevWeek();
		}
	}

	onMount(() => {
		unsubscribe = store.subscribeChanges(refetchCurrentView);
		void (async () => {
			try {
				const babies = await listBabies();
				const baby = babies[0];
				if (baby) {
					babyId = baby.id;
					store.start(baby.id);
				}
				caregivers = await listCaregivers();
			} catch (e) {
				loadError = e instanceof ApiError ? e.userMessage : 'Impossible de charger l’historique.';
			}
		})();
	});

	onDestroy(() => {
		unsubscribe?.();
	});

	$effect(() => {
		dayKey;
		babyId;
		void loadDay();
	});

	$effect(() => {
		dayKey;
		babyId;
		if (viewMode === 'week') {
			void loadWeek();
			void loadPrevWeek();
		}
	});

	// Switching to 'week' is enough on its own: the $effect above reads
	// `viewMode` inside its condition, so it is already a tracked dependency
	// and re-runs (calling loadWeek()) whenever viewMode changes. A second,
	// explicit loadWeek() call here was a duplicate load (review item 4).
	function selectViewMode(mode: 'day' | 'week'): void {
		viewMode = mode;
	}

	function selectWeekDay(nextDayKey: string): void {
		dayKey = nextDayKey;
		viewMode = 'day';
	}

	function toggleCategory(cat: Category): void {
		const next = new Set(selectedCategories);
		if (next.has(cat)) next.delete(cat);
		else next.add(cat);
		selectedCategories = next;
	}

	let editEvent = $state<EventDTO | null>(null);
	let editOpen = $state(false);
	let addOpen = $state(false);
	// Several undo windows can be open at once, keyed by event id (same pattern
	// as the Today screen's toast queue).
	let toasts = $state<{ id: string; message: string; onUndo: () => Promise<void> }[]>([]);

	function selectEvent(event: EventDTO): void {
		editEvent = event;
		editOpen = true;
	}

	// Direct-merge path (slice-3 pattern): a confirmed HTTP response is applied
	// to `dayEvents`/`weekEvents` synchronously, the moment the write is
	// confirmed — never presented as saved only once a background refetch
	// happens to land (FR-018). `refetchCurrentView()` still runs afterward as
	// reinforcement (e.g. to pick up whether an edit moved an event out of the
	// current window), but it is not the only path to a correct list.
	function mergeEventLocally(event: EventDTO): void {
		dayEvents = upsertById(dayEvents, event);
		if (weekEvents.length > 0) weekEvents = upsertById(weekEvents, event);
	}

	function removeEventLocally(id: string): void {
		dayEvents = removeById(dayEvents, id);
		weekEvents = removeById(weekEvents, id);
	}

	function handleSaved(event: EventDTO): void {
		mergeEventLocally(event);
		refetchCurrentView();
	}

	function handleDeleted(event: EventDTO, message: string, onUndo: () => Promise<EventDTO>): void {
		removeEventLocally(event.id);
		refetchCurrentView();
		toasts = [
			...toasts.filter((t) => t.id !== event.id),
			{
				id: event.id,
				message,
				onUndo: () =>
					onUndo().then((restored) => {
						mergeEventLocally(restored);
						refetchCurrentView();
					})
			}
		];
	}

	function dismissToast(id: string): void {
		toasts = toasts.filter((t) => t.id !== id);
	}

	// Overlap, not starts-in-day (review item 2): a carry-over session (e.g.
	// sleep 23:30→01:30) must stay visible on both the day it started and the
	// day it ended, not just the former — dailySummary's counts still
	// attribute to the start day only, so this only changes what's listed.
	const dayVisibleEvents = $derived(
		dayEvents
			.filter((e) => e.deletedAt === null)
			.filter((e) => eventOverlapsDay(e, dayKey, store.nowMs))
	);

	const filteredEvents = $derived(
		[...dayVisibleEvents]
			.filter((e) => selectedCategories.has(CATEGORY_OF[e.type]))
			.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
	);

	const manualAddDefault = $derived(manualAddDefaultTime(dayKey, todayKey, store.nowMs));
</script>

<div class="flex flex-col gap-4 p-4">
	<div class="border-border enter flex items-center justify-between gap-2 border-b-2 pb-3">
		<h1 class="text-screen-title text-ink">Historique</h1>
		<button
			type="button"
			disabled={babyId === null}
			onclick={() => (addOpen = true)}
			class="bg-primary text-on-primary active:bg-primary-pressed flex min-h-12 items-center justify-start gap-2 rounded-control px-4 py-2 font-semibold active:translate-y-px motion-reduce:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
		>
			<Plus size={18} aria-hidden="true" />
			Ajouter
		</button>
	</div>

	<div class="enter" style="--enter-delay: 60ms">
		<DaySelector {dayKey} {todayKey} onChange={(next) => (dayKey = next)} />
	</div>

	{#if loadError}
		<p class="text-danger text-base" role="alert">{loadError}</p>
	{/if}

	<div
		class="border-border divide-border-hair enter grid grid-cols-2 divide-x border-2"
		style="--enter-delay: 120ms"
		role="group"
		aria-label="Vue jour ou semaine"
	>
		{#each [{ mode: 'day' as const, label: 'Jour' }, { mode: 'week' as const, label: 'Semaine' }] as tab (tab.mode)}
			<button
				type="button"
				aria-pressed={viewMode === tab.mode}
				onclick={() => selectViewMode(tab.mode)}
				class="flex h-[46px] items-center justify-center text-base font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset {viewMode ===
				tab.mode
					? 'bg-ink text-surface'
					: 'text-ink-muted'}"
			>
				{tab.label}
			</button>
		{/each}
	</div>

	{#if viewMode === 'week'}
		<WeekView
			events={weekEvents}
			prevEvents={prevWeekEvents}
			mondayKey={mondayOf(dayKey)}
			prevMondayKey={prevMondayOf(dayKey)}
			{todayKey}
			nowMs={store.nowMs}
			onSelectDay={selectWeekDay}
		/>
	{:else}
		<div
			class="border-border divide-border-hair grid grid-cols-3 divide-x border-2"
			role="group"
			aria-label="Filtrer par catégorie"
		>
			{#each CHIPS as chip (chip.key)}
				{@const active = selectedCategories.has(chip.key)}
				<button
					type="button"
					aria-pressed={active}
					onclick={() => toggleCategory(chip.key)}
					class="flex min-h-12 min-w-0 items-center justify-center gap-2 px-1 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset {active
						? 'bg-surface-raised text-ink'
						: 'text-ink-muted'}"
				>
					<span class="h-4 w-1 shrink-0 {active ? chip.barClass : 'bg-border-hair'}" aria-hidden="true"
					></span>
					<span class="truncate text-xs font-bold">{chip.label}</span>
				</button>
			{/each}
		</div>

		{#if showSkeleton}
			<div class="flex flex-col gap-2" aria-hidden="true">
				{#each [0, 1, 2] as i (i)}
					<div class="bg-surface-raised h-12 animate-pulse rounded-control motion-reduce:animate-none"></div>
				{/each}
			</div>
		{:else}
			<h2 class="sr-only">Grille horaire de la journée</h2>
			<DayCalendar
				events={filteredEvents}
				{dayKey}
				{todayKey}
				nowMs={store.nowMs}
				onSelect={selectEvent}
			/>
			<h2 class="text-section text-ink-muted uppercase">
				Événements · <span class="tabular-nums">{filteredEvents.length}</span>
			</h2>
			<EventList events={filteredEvents} {dayKey} nowMs={store.nowMs} {caregivers} onSelect={selectEvent} />
		{/if}
	{/if}
</div>

<EventEditSheet bind:open={editOpen} event={editEvent} {caregivers} onSaved={handleSaved} onDeleted={handleDeleted} />
<ManualAddSheet bind:open={addOpen} {babyId} defaultAt={manualAddDefault} {caregivers} onSaved={handleSaved} />

{#if toasts.length > 0}
	<div class="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-md flex-col-reverse gap-2">
		{#each toasts as toast (toast.id)}
			<UndoToast
				message={toast.message}
				onAction={toast.onUndo}
				onDismiss={() => dismissToast(toast.id)}
			/>
		{/each}
	</div>
{/if}
