<script lang="ts">
	import { getContext } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import { Droplets } from '@lucide/svelte';
	import { createEvent, deleteEvent, ApiError } from '$lib/client/api';
	import { formatElapsed } from '$lib/client/format';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import type { DiaperDetails, EventDTO } from '$lib/client/types';

	let {
		babyId,
		caregiverId,
		onSaved
	}: {
		babyId: string | null;
		caregiverId: string | null;
		onSaved: (message: string, onUndo: () => void) => void;
	} = $props();

	const store = getContext<SyncStore>('sync');

	let pending = $state(false);
	let error = $state<string | null>(null);

	const lastDiaper = $derived(store.events.find((e) => e.type === 'diaper'));
	const todayCount = $derived(store.events.filter((e) => e.type === 'diaper').length);

	const lastDiaperLabel = $derived.by(() => {
		const event = lastDiaper;
		if (!event) return null;
		const label = diaperLabel(event.details as DiaperDetails);
		const elapsed = formatElapsed(store.nowMs - Date.parse(event.startedAt));
		return `${label} · il y a ${elapsed}`;
	});

	function diaperLabel(details: DiaperDetails): string {
		if (details.pee && details.poo) return 'Pipi et caca';
		if (details.poo) return 'Caca';
		return 'Pipi';
	}

	async function record(pee: boolean, poo: boolean): Promise<void> {
		if (babyId === null || pending) return;
		pending = true;
		error = null;
		let event: EventDTO;
		try {
			event = await createEvent({
				babyId,
				caregiverId,
				type: 'diaper',
				startedAt: new Date(store.nowMs).toISOString(),
				details: { pee, poo }
			});
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Une erreur est survenue.';
			pending = false;
			return;
		}
		pending = false;
		onSaved('Couche enregistrée', () => {
			void deleteEvent(event.id);
		});
	}
</script>

<Card.Root class="bg-diaper-100 border-0">
	<Card.Content class="flex flex-col gap-3">
		<div class="flex items-center gap-2">
			<Droplets size={20} class="text-diaper-700" aria-hidden="true" />
			<h2 class="text-diaper-700 font-semibold">Couche</h2>
		</div>
		<p class="text-ink-muted text-sm tabular-nums">
			{lastDiaperLabel ?? 'Aucune couche aujourd’hui'}
		</p>
		{#if todayCount > 0}
			<p class="text-ink-muted tabular-nums text-xs">
				{todayCount} couche{todayCount > 1 ? 's' : ''} aujourd’hui
			</p>
		{/if}
		<div class="grid grid-cols-3 gap-2">
			<button
				type="button"
				disabled={pending || babyId === null}
				onclick={() => record(true, false)}
				class="bg-surface-raised text-diaper-700 min-h-12 rounded-control px-2 py-2 font-medium active:scale-[0.97] disabled:opacity-50 motion-reduce:active:scale-100"
			>
				Pipi
			</button>
			<button
				type="button"
				disabled={pending || babyId === null}
				onclick={() => record(false, true)}
				class="bg-surface-raised text-diaper-700 min-h-12 rounded-control px-2 py-2 font-medium active:scale-[0.97] disabled:opacity-50 motion-reduce:active:scale-100"
			>
				Caca
			</button>
			<button
				type="button"
				disabled={pending || babyId === null}
				onclick={() => record(true, true)}
				class="bg-surface-raised text-diaper-700 min-h-12 rounded-control px-2 py-2 font-medium active:scale-[0.97] disabled:opacity-50 motion-reduce:active:scale-100"
			>
				Les deux
			</button>
		</div>
		{#if error}
			<p class="text-danger text-sm" role="alert">{error}</p>
		{/if}
	</Card.Content>
</Card.Root>
