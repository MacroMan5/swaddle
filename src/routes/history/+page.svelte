<script lang="ts">
	// Historique (FR-009/FR-010): day selector, chronological list, category
	// filters, day summary and week view. The window state, its fetches and the
	// anti-race machinery live in `historyWindow.svelte.ts`; this page is markup,
	// bindings and purely presentational state.
	import { getContext, onDestroy, onMount } from 'svelte';
	import { Plus, Trash2 } from '@lucide/svelte';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import type { EventDTO } from '$lib/client/types';
	import { CATEGORY_OF, type Category } from '$lib/components/today/todayDerivations';
	import DaySelector from '$lib/components/history/DaySelector.svelte';
	import DayCalendar from '$lib/components/history/DayCalendar.svelte';
	import EventEditSheet from '$lib/components/history/EventEditSheet.svelte';
	import { manualAddDefaultTime } from '$lib/components/history/eventForm';
	import EventList from '$lib/components/history/EventList.svelte';
	import { HistoryWindow } from '$lib/components/history/historyWindow.svelte';
	import ManualAddSheet from '$lib/components/history/ManualAddSheet.svelte';
	import RecentlyDeletedSheet from '$lib/components/history/RecentlyDeletedSheet.svelte';
	import UndoToast from '$lib/components/UndoToast.svelte';
	import WeekView from '$lib/components/history/WeekView.svelte';
	import { pageTitle } from '$lib/meta';

	const store = getContext<SyncStore>('sync');
	const view = new HistoryWindow(store);

	// Tailwind needs literal class names at build time (no `bg-${x}-700` templating).
	const CHIPS: { key: Category; label: string; barClass: string }[] = [
		{ key: 'feed', label: 'Alimentation', barClass: 'bg-feed-700' },
		{ key: 'diaper', label: 'Couche', barClass: 'bg-diaper-700' },
		{ key: 'sleep', label: 'Sommeil', barClass: 'bg-sleep-700' }
	];

	let selectedCategories = $state<Set<Category>>(new Set(['feed', 'diaper', 'sleep']));
	let editEvent = $state<EventDTO | null>(null);
	let editOpen = $state(false);
	let addOpen = $state(false);
	let recentlyDeletedOpen = $state(false);
	// Several undo windows can be open at once, keyed by event id (same pattern
	// as the Today screen's toast queue).
	let toasts = $state<{ id: string; message: string; onUndo: () => Promise<void> }[]>([]);

	onMount(() => view.start());
	onDestroy(() => view.stop());

	function toggleCategory(cat: Category): void {
		const next = new Set(selectedCategories);
		if (next.has(cat)) next.delete(cat);
		else next.add(cat);
		selectedCategories = next;
	}

	function selectEvent(event: EventDTO): void {
		editEvent = event;
		editOpen = true;
	}

	function handleSaved(event: EventDTO): void {
		view.mergeEvent(event);
		view.refetchCurrentView();
	}

	function handleRestored(event: EventDTO): void {
		view.mergeEvent(event);
		view.refetchCurrentView();
	}

	function handleDeleted(event: EventDTO, message: string, onUndo: () => Promise<EventDTO>): void {
		view.removeEvent(event);
		view.refetchCurrentView();
		toasts = [
			...toasts.filter((t) => t.id !== event.id),
			{
				id: event.id,
				message,
				onUndo: () =>
					onUndo().then((restored) => {
						view.mergeEvent(restored);
						view.refetchCurrentView();
					})
			}
		];
	}

	function dismissToast(id: string): void {
		toasts = toasts.filter((t) => t.id !== id);
	}

	const filteredEvents = $derived(
		view.visibleDayEvents.filter((e) => selectedCategories.has(CATEGORY_OF[e.type]))
	);

	const manualAddDefault = $derived(
		manualAddDefaultTime(view.dayKey, view.todayKey, view.nowMs)
	);
</script>

<svelte:head>
	<title>{pageTitle('Historique')}</title>
</svelte:head>

<div class="flex flex-col gap-4 p-4">
	<div class="border-border enter flex items-center justify-between gap-2 border-b-2 pb-3">
		<h1 class="text-screen-title text-ink truncate">Historique</h1>
		<div class="flex shrink-0 items-center gap-2">
			<button
				type="button"
				disabled={view.babyId === null}
				onclick={() => (recentlyDeletedOpen = true)}
				aria-label="Supprimés récemment"
				class="border-border text-ink-muted flex min-h-12 min-w-12 items-center justify-center rounded-control border-2 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:active:translate-y-0"
			>
				<Trash2 size={18} aria-hidden="true" />
			</button>
			<button
				type="button"
				disabled={view.babyId === null}
				onclick={() => (addOpen = true)}
				class="bg-primary text-on-primary active:bg-primary-pressed flex min-h-12 items-center justify-start gap-2 rounded-control px-4 py-2 font-semibold active:translate-y-px motion-reduce:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
			>
				<Plus size={18} aria-hidden="true" />
				Ajouter
			</button>
		</div>
	</div>

	<div class="enter" style="--enter-delay: 60ms">
		<DaySelector
			dayKey={view.dayKey}
			todayKey={view.todayKey}
			onChange={(next) => view.setDayKey(next)}
		/>
	</div>

	{#if view.loadError}
		<p class="text-danger text-base" role="alert">{view.loadError}</p>
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
				aria-pressed={view.viewMode === tab.mode}
				onclick={() => view.setViewMode(tab.mode)}
				class="flex h-[46px] items-center justify-center text-base font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset {view.viewMode ===
				tab.mode
					? 'bg-ink text-surface'
					: 'text-ink-muted'}"
			>
				{tab.label}
			</button>
		{/each}
	</div>

	{#if view.viewMode === 'week'}
		<WeekView
			events={view.weekEvents}
			prevEvents={view.prevWeekEvents}
			mondayKey={view.mondayKey}
			prevMondayKey={view.prevMondayKey}
			todayKey={view.todayKey}
			nowMs={view.nowMs}
			onSelectDay={(next) => view.selectWeekDay(next)}
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

		{#if view.showSkeleton}
			<div class="flex flex-col gap-2" aria-hidden="true">
				{#each [0, 1, 2] as i (i)}
					<div class="bg-surface-raised h-12 animate-pulse rounded-control motion-reduce:animate-none"></div>
				{/each}
			</div>
		{:else}
			<h2 class="sr-only">Grille horaire de la journée</h2>
			<DayCalendar
				events={filteredEvents}
				dayKey={view.dayKey}
				todayKey={view.todayKey}
				nowMs={view.nowMs}
				onSelect={selectEvent}
			/>
			<h2 class="text-section text-ink-muted uppercase">
				Événements · <span class="tabular-nums">{filteredEvents.length}</span>
			</h2>
			<EventList
				events={filteredEvents}
				dayKey={view.dayKey}
				nowMs={view.nowMs}
				caregivers={view.caregivers}
				onSelect={selectEvent}
			/>
		{/if}
	{/if}
</div>

<EventEditSheet
	bind:open={editOpen}
	event={editEvent}
	caregivers={view.caregivers}
	onSaved={handleSaved}
	onDeleted={handleDeleted}
/>
<ManualAddSheet
	bind:open={addOpen}
	babyId={view.babyId}
	defaultAt={manualAddDefault}
	caregivers={view.caregivers}
	onSaved={handleSaved}
/>
<RecentlyDeletedSheet
	bind:open={recentlyDeletedOpen}
	babyId={view.babyId}
	onRestored={handleRestored}
/>

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
