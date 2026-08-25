<script lang="ts">
	// Elapsed time since the last event of each category (the "1 h 05" the
	// parent actually checks at 3am), replacing the floating paragraphs the old
	// category cards carried. Formulas live in todayDerivations.ts.
	import { getContext } from 'svelte';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import {
		activeCategories,
		elapsedSinceLabel,
		lastOfCategory,
		type Category
	} from './todayDerivations';

	const store = getContext<SyncStore>('sync');

	const CELLS: { key: Category; label: string; labelClass: string }[] = [
		{ key: 'feed', label: 'Alimentation', labelClass: 'text-feed-700' },
		{ key: 'diaper', label: 'Couche', labelClass: 'text-diaper-700' },
		{ key: 'sleep', label: 'Sommeil', labelClass: 'text-sleep-700' }
	];

	const active = $derived(activeCategories(store.timers));
</script>

<div class="border-border divide-border-hair grid grid-cols-3 divide-x border-b-2 pb-3">
	{#each CELLS as cell (cell.key)}
		<div class="flex flex-col gap-1.5 px-2 first:pl-0 last:pr-0">
			<span class="text-category uppercase {cell.labelClass}">{cell.label}</span>
			{#if active.has(cell.key)}
				<span class="text-stat text-ink">en cours</span>
			{:else}
				<span class="text-stat text-ink tabular-nums"
					>{elapsedSinceLabel(lastOfCategory(store.events, cell.key), store.nowMs)}</span
				>
			{/if}
		</div>
	{/each}
</div>
