<script lang="ts">
	import { getContext } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import { Heart, Milk, Wind } from '@lucide/svelte';
	import { formatElapsed } from '$lib/client/format';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import BottleSheet from './BottleSheet.svelte';
	import PumpSheet from './PumpSheet.svelte';

	let {
		babyId,
		caregiverId,
		onSaved,
		onOpenNursing
	}: {
		babyId: string | null;
		caregiverId: string | null;
		onSaved: (id: string, message: string, onUndo: () => Promise<void>) => void;
		onOpenNursing: () => void;
	} = $props();

	const store = getContext<SyncStore>('sync');

	let bottleOpen = $state(false);
	let pumpOpen = $state(false);

	const nursingActive = $derived(store.timers.some((t) => t.type === 'nursing'));
	const pumpActive = $derived(store.timers.some((t) => t.type === 'pump'));

	const lastFeeding = $derived(
		store.events.find((e) => e.type === 'nursing' || e.type === 'bottle' || e.type === 'pump')
	);

	// Per-type counts (item 11): a bottle or a pump session is not a "tétée".
	const nursingCount = $derived(store.events.filter((e) => e.type === 'nursing').length);
	const bottleCount = $derived(store.events.filter((e) => e.type === 'bottle').length);
	const pumpCount = $derived(store.events.filter((e) => e.type === 'pump').length);

	const todaySummaryLabel = $derived.by(() => {
		const parts: string[] = [];
		if (nursingCount > 0) parts.push(`${nursingCount} allaitement${nursingCount > 1 ? 's' : ''}`);
		if (bottleCount > 0) parts.push(`${bottleCount} biberon${bottleCount > 1 ? 's' : ''}`);
		if (pumpCount > 0) parts.push(`${pumpCount} tirage${pumpCount > 1 ? 's' : ''}`);
		return parts.length > 0 ? `${parts.join(' · ')} aujourd’hui` : null;
	});

	const lastFeedingLabel = $derived.by(() => {
		const event = lastFeeding;
		if (!event) return null;
		const label =
			event.type === 'nursing' ? 'Allaitement' : event.type === 'bottle' ? 'Biberon' : 'Tirage';
		const elapsed = formatElapsed(store.nowMs - Date.parse(event.startedAt));
		return `${label} · il y a ${elapsed}`;
	});

	function scrollToActiveTimers(): void {
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		document
			.querySelector('[data-testid="active-timers"]')
			?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
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
		<p class="text-ink-muted tabular-nums text-base">
			{lastFeedingLabel ?? 'Aucune tétée aujourd’hui'}
		</p>
		{#if todaySummaryLabel}
			<p class="text-ink-muted tabular-nums text-base">
				{todaySummaryLabel}
			</p>
		{/if}
		<div class="grid grid-cols-3 gap-2">
			<button
				type="button"
				disabled={babyId === null}
				onclick={onOpenNursing}
				class="bg-surface-raised text-feed-700 flex min-h-12 items-center justify-center gap-1 rounded-control px-2 py-2 font-medium active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:active:scale-100"
			>
				<Heart size={16} aria-hidden="true" />
				{nursingActive ? 'En cours' : 'Allaiter'}
			</button>
			<button
				type="button"
				disabled={babyId === null}
				onclick={() => (bottleOpen = true)}
				class="bg-surface-raised text-feed-700 flex min-h-12 items-center justify-center gap-1 rounded-control px-2 py-2 font-medium active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:active:scale-100"
			>
				<Milk size={16} aria-hidden="true" />
				Biberon
			</button>
			<button
				type="button"
				disabled={babyId === null}
				onclick={handlePumpTap}
				class="bg-surface-raised text-feed-700 flex min-h-12 items-center justify-center gap-1 rounded-control px-2 py-2 font-medium active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:active:scale-100"
			>
				<Wind size={16} aria-hidden="true" />
				{pumpActive ? 'En cours' : 'Tirage'}
			</button>
		</div>
	</Card.Content>
</Card.Root>

<BottleSheet bind:open={bottleOpen} {babyId} {caregiverId} {onSaved} />
<PumpSheet bind:open={pumpOpen} {babyId} {caregiverId} />
