<script lang="ts">
	// The three most recent events, read-only — editing lives in History. Rows
	// are deliberately non-interactive so the tile names stay unambiguous for
	// assistive tech (and Playwright's strict mode).
	import { getContext } from 'svelte';
	import { formatTimeOfDay } from '$lib/client/format';
	import { eventLabel } from '$lib/components/history/eventDisplay';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import type { CaregiverDTO } from '$lib/client/types';
	import { CATEGORY_OF, type Category } from './todayDerivations';

	let { caregivers }: { caregivers: CaregiverDTO[] } = $props();

	const store = getContext<SyncStore>('sync');

	const BAR: Record<Category, string> = {
		feed: 'bg-feed-700',
		diaper: 'bg-diaper-700',
		sleep: 'bg-sleep-700'
	};

	const recent = $derived(store.events.slice(0, 3));

	function caregiverColor(id: string | null): string | null {
		if (id === null) return null;
		return caregivers.find((c) => c.id === id)?.color ?? null;
	}
</script>

<section class="border-border bg-surface-raised -mx-1 flex flex-col gap-1 border-t-2 px-1 pt-3">
	<h2 class="text-section text-ink-muted uppercase">Derniers événements</h2>
	{#if recent.length === 0}
		<p class="text-ink-muted text-body py-2">Aucune activité — tout commence ici</p>
	{:else}
		<ul class="divide-border-hair divide-y">
			{#each recent as event (event.id)}
				{@const color = caregiverColor(event.caregiverId)}
				<li class="flex items-center gap-2.5 py-2">
					<span class="text-row-time text-ink w-11 shrink-0 tabular-nums"
						>{formatTimeOfDay(Date.parse(event.startedAt))}</span
					>
					<span class="h-5 w-1 shrink-0 {BAR[CATEGORY_OF[event.type]]}" aria-hidden="true"></span>
					<span class="text-row text-ink min-w-0 flex-1 truncate"
						>{eventLabel(event, store.nowMs)}</span
					>
					{#if color !== null}
						<span
							class="border-border size-2.5 shrink-0 border"
							style:background-color={color}
							aria-hidden="true"
						></span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
