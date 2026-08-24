<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { listBabies, ApiError } from '$lib/client/api';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import ActiveTimersCard from '$lib/components/today/ActiveTimersCard.svelte';
	import DiaperCard from '$lib/components/today/DiaperCard.svelte';
	import FeedCard from '$lib/components/today/FeedCard.svelte';
	import NursingSheet from '$lib/components/today/NursingSheet.svelte';
	import SleepCard from '$lib/components/today/SleepCard.svelte';
	import SummaryCard from '$lib/components/today/SummaryCard.svelte';
	import UndoToast from '$lib/components/UndoToast.svelte';

	// Owned by +layout.svelte (the connection banner needs it too); this page
	// just drives start() with the resolved baby id.
	const store = getContext<SyncStore>('sync');

	let babyId = $state<string | null>(null);
	let caregiverId = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	// Owned here, not by a card: both « En cours » and « Allaiter » open the same sheet.
	let nursingOpen = $state(false);
	// Several undo windows can be open at once (item 9): a queue keyed by event id.
	let toasts = $state<{ id: string; message: string; onUndo: () => Promise<void> }[]>([]);

	async function loadBaby(): Promise<void> {
		loadError = null;
		try {
			caregiverId = localStorage.getItem('swaddle.caregiverId');
			const babies = await listBabies();
			const baby = babies[0];
			if (baby) {
				babyId = baby.id;
				store.start(baby.id);
			}
		} catch (e) {
			loadError =
				e instanceof ApiError
					? e.message
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

<div class="flex flex-col gap-4 p-4">
	<h1 class="text-2xl font-bold text-ink">Aujourd’hui</h1>

	{#if loadError}
		<div class="border-border bg-surface-raised flex flex-col gap-2 rounded-card border p-4" role="alert">
			<p class="text-ink text-base">{loadError}</p>
			<button
				type="button"
				onclick={loadBaby}
				class="bg-primary text-on-primary min-h-12 self-start rounded-control px-4 py-2 font-semibold active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:scale-100"
			>
				Réessayer
			</button>
		</div>
	{/if}

	<ActiveTimersCard {babyId} onOpenNursing={() => (nursingOpen = true)} />

	{#if store.events.length === 0 && store.timers.length === 0}
		<p class="text-ink-muted">Aucune activité — tout commence ici</p>
	{/if}

	<FeedCard
		{babyId}
		{caregiverId}
		onSaved={handleSaved}
		onOpenNursing={() => (nursingOpen = true)}
	/>
	<DiaperCard {babyId} {caregiverId} onSaved={handleSaved} />
	<SleepCard {babyId} {caregiverId} />
	<SummaryCard />
</div>

<NursingSheet bind:open={nursingOpen} {babyId} {caregiverId} />

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
