<script lang="ts">
	import { getContext } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import { Heart, Milk, Wind } from '@lucide/svelte';
	import { startTimer, ApiError } from '$lib/client/api';
	import { formatElapsed } from '$lib/client/format';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import type { Side } from '$lib/client/types';
	import BottleSheet from './BottleSheet.svelte';
	import PumpSheet from './PumpSheet.svelte';

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

	let showSideChooser = $state(false);
	let bottleOpen = $state(false);
	let pumpOpen = $state(false);
	let pending = $state(false);
	let error = $state<string | null>(null);

	const nursingActive = $derived(store.timers.some((t) => t.type === 'nursing'));
	const pumpActive = $derived(store.timers.some((t) => t.type === 'pump'));

	const lastFeeding = $derived(
		store.events.find((e) => e.type === 'nursing' || e.type === 'bottle' || e.type === 'pump')
	);

	const lastFeedingLabel = $derived.by(() => {
		const event = lastFeeding;
		if (!event) return null;
		const label =
			event.type === 'nursing' ? 'Allaitement' : event.type === 'bottle' ? 'Biberon' : 'Tirage';
		const elapsed = formatElapsed(store.nowMs - Date.parse(event.startedAt));
		return `${label} · il y a ${elapsed}`;
	});

	function scrollToActiveTimers(): void {
		document
			.querySelector('[data-testid="active-timers"]')
			?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function handleNurseTap(): void {
		if (nursingActive) {
			scrollToActiveTimers();
			return;
		}
		showSideChooser = !showSideChooser;
	}

	async function startNursing(side: Side): Promise<void> {
		if (babyId === null || pending) return;
		pending = true;
		error = null;
		try {
			await startTimer('nursing', { babyId, caregiverId, side });
			showSideChooser = false;
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Une erreur est survenue.';
		} finally {
			pending = false;
		}
	}

	function handlePumpTap(): void {
		if (pumpActive) {
			scrollToActiveTimers();
			return;
		}
		pumpOpen = true;
	}
</script>

<Card.Root class="bg-feed-100 border-0">
	<Card.Content class="flex flex-col gap-3">
		<div class="flex items-center gap-2">
			<Heart size={20} class="text-feed-700" aria-hidden="true" />
			<h2 class="text-feed-700 font-semibold">Alimentation</h2>
		</div>
		<p class="text-ink-muted tabular-nums text-sm">
			{lastFeedingLabel ?? 'Aucune tétée aujourd’hui'}
		</p>
		<div class="grid grid-cols-3 gap-2">
			<button
				type="button"
				disabled={babyId === null}
				onclick={handleNurseTap}
				class="bg-surface-raised text-feed-700 flex min-h-12 items-center justify-center gap-1 rounded-control px-2 py-2 font-medium active:scale-[0.97] disabled:opacity-50 motion-reduce:active:scale-100"
			>
				<Heart size={16} aria-hidden="true" />
				{nursingActive ? 'En cours' : 'Allaiter'}
			</button>
			<button
				type="button"
				disabled={babyId === null}
				onclick={() => (bottleOpen = true)}
				class="bg-surface-raised text-feed-700 flex min-h-12 items-center justify-center gap-1 rounded-control px-2 py-2 font-medium active:scale-[0.97] disabled:opacity-50 motion-reduce:active:scale-100"
			>
				<Milk size={16} aria-hidden="true" />
				Biberon
			</button>
			<button
				type="button"
				disabled={babyId === null}
				onclick={handlePumpTap}
				class="bg-surface-raised text-feed-700 flex min-h-12 items-center justify-center gap-1 rounded-control px-2 py-2 font-medium active:scale-[0.97] disabled:opacity-50 motion-reduce:active:scale-100"
			>
				<Wind size={16} aria-hidden="true" />
				{pumpActive ? 'En cours' : 'Tirage'}
			</button>
		</div>
		{#if showSideChooser}
			<div class="flex gap-2">
				<button
					type="button"
					disabled={pending}
					onclick={() => startNursing('left')}
					class="border-border bg-surface-raised text-ink min-h-12 flex-1 rounded-control border px-2 py-2 font-medium active:scale-[0.97] disabled:opacity-50 motion-reduce:active:scale-100"
				>
					Gauche
				</button>
				<button
					type="button"
					disabled={pending}
					onclick={() => startNursing('right')}
					class="border-border bg-surface-raised text-ink min-h-12 flex-1 rounded-control border px-2 py-2 font-medium active:scale-[0.97] disabled:opacity-50 motion-reduce:active:scale-100"
				>
					Droite
				</button>
			</div>
		{/if}
		{#if error}
			<p class="text-danger text-sm" role="alert">{error}</p>
		{/if}
	</Card.Content>
</Card.Root>

<BottleSheet bind:open={bottleOpen} {babyId} {caregiverId} {onSaved} />
<PumpSheet bind:open={pumpOpen} {babyId} {caregiverId} />
