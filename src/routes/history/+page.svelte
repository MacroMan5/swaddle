<script lang="ts">
	// Historique (FR-009/FR-010): day selector, chronological list, category
	// filters and the day summary. Week view and editing arrive in later tasks
	// of the same slice.
	import { getContext, onDestroy, onMount } from 'svelte';
	import { Milk, Droplets, Moon } from '@lucide/svelte';
	import { ApiError, listBabies, listCaregivers, listEvents } from '$lib/client/api';
	import { dailySummary, dayRangeIso, localDayKey } from '$lib/client/summaries';
	import { formatElapsed } from '$lib/client/format';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import type { CaregiverDTO, EventDTO, EventType } from '$lib/client/types';
	import DayPicker from '$lib/components/history/DayPicker.svelte';
	import DayTimeline from '$lib/components/history/DayTimeline.svelte';
	import EventList from '$lib/components/history/EventList.svelte';
	import WeekView from '$lib/components/history/WeekView.svelte';

	const store = getContext<SyncStore>('sync');

	type Category = 'feed' | 'diaper' | 'sleep';
	const CATEGORY_OF: Record<EventType, Category> = {
		nursing: 'feed',
		bottle: 'feed',
		pump: 'feed',
		diaper: 'diaper',
		sleep: 'sleep'
	};
	// Tailwind needs literal class names at build time (no `bg-${x}-100` templating).
	const CHIPS: { key: Category; label: string; icon: typeof Milk; activeClass: string }[] = [
		{ key: 'feed', label: 'Alimentation', icon: Milk, activeClass: 'bg-feed-100 text-feed-700 border-feed-100' },
		{
			key: 'diaper',
			label: 'Couche',
			icon: Droplets,
			activeClass: 'bg-diaper-100 text-diaper-700 border-diaper-100'
		},
		{ key: 'sleep', label: 'Sommeil', icon: Moon, activeClass: 'bg-sleep-100 text-sleep-700 border-sleep-100' }
	];

	const todayKey = localDayKey(new Date());

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
	let loading = $state(false);
	let showSkeleton = $state(false);
	let loadError = $state<string | null>(null);
	let unsubscribe: (() => void) | null = null;
	let skeletonTimer: ReturnType<typeof setTimeout> | null = null;

	async function loadDay(): Promise<void> {
		if (babyId === null) return;
		loading = true;
		loadError = null;
		skeletonTimer = setTimeout(() => {
			showSkeleton = true;
		}, 300);
		try {
			const { from, to } = dayRangeIso(dayKey);
			dayEvents = await listEvents(babyId, from, to, true);
		} catch (e) {
			loadError = e instanceof ApiError ? e.message : 'Impossible de charger l’historique.';
		} finally {
			loading = false;
			showSkeleton = false;
			if (skeletonTimer) clearTimeout(skeletonTimer);
		}
	}

	async function loadWeek(): Promise<void> {
		if (babyId === null) return;
		try {
			const monday = mondayOf(dayKey);
			const { from } = dayRangeIso(monday);
			const [y, m, d] = monday.split('-').map(Number);
			const to = new Date(y, m - 1, d + 7).toISOString();
			weekEvents = await listEvents(babyId, from, to, true);
		} catch (e) {
			loadError = e instanceof ApiError ? e.message : 'Impossible de charger l’historique.';
		}
	}

	function refetchCurrentView(): void {
		void loadDay();
		if (viewMode === 'week') void loadWeek();
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
				loadError = e instanceof ApiError ? e.message : 'Impossible de charger l’historique.';
			}
		})();
	});

	onDestroy(() => {
		unsubscribe?.();
		if (skeletonTimer) clearTimeout(skeletonTimer);
	});

	$effect(() => {
		dayKey;
		babyId;
		void loadDay();
	});

	$effect(() => {
		dayKey;
		babyId;
		if (viewMode === 'week') void loadWeek();
	});

	function selectViewMode(mode: 'day' | 'week'): void {
		viewMode = mode;
		if (mode === 'week') void loadWeek();
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

	function selectEvent(event: EventDTO): void {
		// Wired to the edit sheet in a later task of this slice.
		void event;
	}

	const dayVisibleEvents = $derived(
		dayEvents
			.filter((e) => e.deletedAt === null)
			.filter((e) => localDayKey(new Date(Date.parse(e.startedAt))) === dayKey)
	);

	const filteredEvents = $derived(
		[...dayVisibleEvents]
			.filter((e) => selectedCategories.has(CATEGORY_OF[e.type]))
			.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
	);

	const summary = $derived(dailySummary(dayEvents.filter((e) => e.deletedAt === null), dayKey, store.nowMs));
</script>

<div class="flex flex-col gap-4 p-4">
	<h1 class="text-ink text-2xl font-bold">Historique</h1>

	<DayPicker {dayKey} {todayKey} onChange={(next) => (dayKey = next)} />

	{#if loadError}
		<p class="text-danger text-base" role="alert">{loadError}</p>
	{/if}

	<div
		class="border-border bg-surface-raised flex min-h-12 rounded-control border p-1"
		role="group"
		aria-label="Vue jour ou semaine"
	>
		{#each [{ mode: 'day' as const, label: 'Jour' }, { mode: 'week' as const, label: 'Semaine' }] as tab (tab.mode)}
			<button
				type="button"
				aria-pressed={viewMode === tab.mode}
				onclick={() => selectViewMode(tab.mode)}
				class="min-h-10 flex-1 rounded-control text-base font-medium active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:scale-100 {viewMode ===
				tab.mode
					? 'bg-primary text-on-primary'
					: 'text-ink-muted'}"
			>
				{tab.label}
			</button>
		{/each}
	</div>

	{#if viewMode === 'week'}
		<WeekView events={weekEvents} mondayKey={mondayOf(dayKey)} {todayKey} nowMs={store.nowMs} onSelectDay={selectWeekDay} />
	{:else}
		<div class="flex gap-2" role="group" aria-label="Filtrer par catégorie">
			{#each CHIPS as chip (chip.key)}
				{@const active = selectedCategories.has(chip.key)}
				<button
					type="button"
					aria-pressed={active}
					onclick={() => toggleCategory(chip.key)}
					class="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control border px-2 py-2 text-base font-medium active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:scale-100 {active
						? chip.activeClass
						: 'bg-surface-raised text-ink-muted border-border'}"
				>
					<chip.icon size={18} aria-hidden="true" />
					{chip.label}
				</button>
			{/each}
		</div>

		<dl
			data-testid="day-summary"
			class="border-border bg-surface-raised text-ink grid grid-cols-2 gap-x-4 gap-y-1 rounded-card border p-4 text-base tabular-nums"
		>
			{#if summary.nursing.count > 0}
				<dt class="text-ink-muted">Allaitement</dt>
				<dd>{summary.nursing.count} · {formatElapsed(summary.nursing.totalMs)}</dd>
			{/if}
			{#if summary.bottle.count > 0}
				<dt class="text-ink-muted">Biberon</dt>
				<dd>{summary.bottle.count} · {summary.bottle.totalMl} ml</dd>
			{/if}
			{#if summary.pump.count > 0}
				<dt class="text-ink-muted">Tire-lait</dt>
				<dd>{summary.pump.count} · {summary.pump.totalMl} ml</dd>
			{/if}
			{#if summary.diaper.count > 0}
				<dt class="text-ink-muted">Couches</dt>
				<dd>{summary.diaper.pee} pipi, {summary.diaper.poo} caca</dd>
			{/if}
			{#if summary.sleep.totalMs > 0}
				<dt class="text-ink-muted">Sommeil</dt>
				<dd>{formatElapsed(summary.sleep.totalMs)}</dd>
			{/if}
			{#if summary.nursing.count === 0 && summary.bottle.count === 0 && summary.pump.count === 0 && summary.diaper.count === 0 && summary.sleep.totalMs === 0}
				<dd class="text-ink-muted col-span-2">Aucun résumé pour ce jour.</dd>
			{/if}
		</dl>

		{#if showSkeleton}
			<div class="flex flex-col gap-2" aria-hidden="true">
				{#each [0, 1, 2] as i (i)}
					<div class="bg-surface-raised h-12 animate-pulse rounded-control motion-reduce:animate-none"></div>
				{/each}
			</div>
		{:else}
			<DayTimeline events={filteredEvents} {dayKey} nowMs={store.nowMs} />
			<EventList events={filteredEvents} {dayKey} nowMs={store.nowMs} {caregivers} onSelect={selectEvent} />
		{/if}
	{/if}
</div>
