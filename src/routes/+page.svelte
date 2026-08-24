<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { listBabies } from '$lib/client/api';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import ActiveTimersCard from '$lib/components/today/ActiveTimersCard.svelte';
	import DiaperCard from '$lib/components/today/DiaperCard.svelte';
	import FeedCard from '$lib/components/today/FeedCard.svelte';
	import SleepCard from '$lib/components/today/SleepCard.svelte';
	import UndoToast from '$lib/components/UndoToast.svelte';

	// Owned by +layout.svelte (the connection banner needs it too); this page
	// just drives start() with the resolved baby id.
	const store = getContext<SyncStore>('sync');

	let babyId = $state<string | null>(null);
	let caregiverId = $state<string | null>(null);
	let toast = $state<{ message: string; onUndo: () => void } | null>(null);

	onMount(async () => {
		caregiverId = localStorage.getItem('swaddle.caregiverId');
		const babies = await listBabies();
		const baby = babies[0];
		if (baby) {
			babyId = baby.id;
			store.start(baby.id);
		}
	});

	function handleSaved(message: string, onUndo: () => void): void {
		toast = { message, onUndo };
	}
</script>

<div class="flex flex-col gap-4 p-4">
	<h1 class="text-2xl font-bold text-ink">Aujourd’hui</h1>

	{#if store.events.length === 0}
		<p class="text-ink-muted">Aucune activité — tout commence ici</p>
	{/if}

	<ActiveTimersCard {babyId} />
	<FeedCard {babyId} {caregiverId} onSaved={handleSaved} />
	<DiaperCard {babyId} {caregiverId} onSaved={handleSaved} />
	<SleepCard {babyId} {caregiverId} />
</div>

{#if toast}
	<UndoToast
		message={toast.message}
		onAction={toast.onUndo}
		onDismiss={() => (toast = null)}
	/>
{/if}
