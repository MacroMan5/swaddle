<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { listBabies, listCaregivers, ApiError } from '$lib/client/api';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import type { CaregiverDTO } from '$lib/client/types';
	import ActiveTimerBanner from '$lib/components/today/ActiveTimerBanner.svelte';
	import BottleSheet from '$lib/components/today/BottleSheet.svelte';
	import DaySummary from '$lib/components/today/DaySummary.svelte';
	import NursingSheet from '$lib/components/today/NursingSheet.svelte';
	import PumpSheet from '$lib/components/today/PumpSheet.svelte';
	import QuickActions from '$lib/components/today/QuickActions.svelte';
	import RecentEvents from '$lib/components/today/RecentEvents.svelte';
	import StatusStrip from '$lib/components/today/StatusStrip.svelte';
	import TodayHeader from '$lib/components/today/TodayHeader.svelte';
	import UndoToast from '$lib/components/UndoToast.svelte';

	// Owned by +layout.svelte (the connection banner needs it too); this page
	// just drives start() with the resolved baby id.
	const store = getContext<SyncStore>('sync');

	let caregivers = $state<CaregiverDTO[]>([]);
	let caregiverId = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	// Sheets are owned here, not by a tile: « En cours » in the timer banner and
	// the Allaiter tile open the same nursing sheet; Biberon/Tirage likewise.
	let nursingOpen = $state(false);
	let bottleOpen = $state(false);
	let pumpOpen = $state(false);
	// Several undo windows can be open at once (item 9): a queue keyed by event id.
	let toasts = $state<{ id: string; message: string; onUndo: () => Promise<void> }[]>([]);

	// The baby lives on the store (#46: `baby` SSE messages keep it live across
	// devices), not as a local copy that a correction elsewhere would leave stale.
	const babyId = $derived(store.baby?.id ?? null);
	// One alert for the whole bootstrap: the baby/caregiver load and the events
	// load (issue #47) fail the same way from the user's point of view.
	const bootstrapError = $derived(loadError ?? store.eventsError);

	/**
	 * Retries every failed part, not just the first one. Both can be in error at
	 * once: the store is layout-scoped, so an events error survives a trip to
	 * another screen and back, where a fresh loadBaby() may fail in its turn. A
	 * successful start() for a *new* baby clears the events error itself (it
	 * resets the store), but start() for the baby already running is a no-op —
	 * hence the second check, which then reloads the day.
	 */
	async function retryBootstrap(): Promise<void> {
		if (loadError !== null) await loadBaby();
		if (store.eventsError !== null) await store.refreshEvents();
	}

	async function loadBaby(): Promise<void> {
		loadError = null;
		try {
			caregiverId = localStorage.getItem('swaddle.caregiverId');
			const [babies, caregiverList] = await Promise.all([listBabies(), listCaregivers()]);
			caregivers = caregiverList;
			const first = babies[0];
			if (first) {
				store.start(first.id);
				store.setBaby(first);
			}
		} catch (e) {
			loadError =
				e instanceof ApiError
					? e.userMessage
					: 'Impossible de charger les données. Vérifiez votre connexion.';
		}
	}

	onMount(() => {
		void loadBaby();
	});

	function handleSaved(id: string, message: string, onUndo: () => Promise<void>): void {
		toasts = [...toasts.filter((t) => t.id !== id), { id, message, onUndo }];
	}

	function dismissToast(id: string): void {
		toasts = toasts.filter((t) => t.id !== id);
	}
</script>

<div class="flex min-h-[calc(100dvh-6rem)] flex-col gap-4 p-4">
	<ActiveTimerBanner {babyId} {caregivers} onOpenNursing={() => (nursingOpen = true)} />

	<!-- Staggered entrance, first mount only — these wrappers are never
	     remounted by an SSE update, so the animation cannot replay. -->
	<div class="enter">
		<TodayHeader babyName={store.baby?.name ?? null} birthdate={store.baby?.birthdate ?? null} />
	</div>

	{#if bootstrapError}
		<div
			class="border-border bg-surface-raised flex flex-col gap-2 rounded-card border-2 p-4"
			role="alert"
			data-testid="bootstrap-error"
		>
			<p class="text-ink text-base">{bootstrapError}</p>
			<button
				type="button"
				onclick={retryBootstrap}
				class="bg-primary text-on-primary active:bg-primary-pressed min-h-12 self-start rounded-control px-4 py-2 font-semibold active:translate-y-px motion-reduce:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
			>
				Réessayer
			</button>
		</div>
	{/if}

	<div class="enter" style="--enter-delay: 60ms">
		<StatusStrip />
	</div>

	<div class="enter" style="--enter-delay: 120ms">
		<QuickActions
			{babyId}
			{caregiverId}
			onSaved={handleSaved}
			onOpenNursing={() => (nursingOpen = true)}
			onOpenBottle={() => (bottleOpen = true)}
			onOpenPump={() => (pumpOpen = true)}
		/>
	</div>

	<div class="enter" style="--enter-delay: 180ms">
		<RecentEvents {caregivers} />
	</div>

	<div class="enter mt-auto" style="--enter-delay: 240ms">
		<DaySummary />
	</div>
</div>

<NursingSheet bind:open={nursingOpen} {babyId} {caregiverId} />
<BottleSheet bind:open={bottleOpen} {babyId} {caregiverId} onSaved={handleSaved} />
<PumpSheet bind:open={pumpOpen} {babyId} {caregiverId} />

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
