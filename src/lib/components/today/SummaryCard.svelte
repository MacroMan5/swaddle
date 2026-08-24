<script lang="ts">
	// Light daily aggregate (FR-008): counts and totals only. Per-event detail and
	// editing stay in slice 4's history screen.
	import { getContext } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import { ClipboardList } from '@lucide/svelte';
	import { formatElapsed, nursingDurationMs } from '$lib/client/format';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import type { BottleDetails, DiaperDetails, NursingDetails } from '$lib/client/types';

	const store = getContext<SyncStore>('sync');

	const nursingEvents = $derived(store.events.filter((e) => e.type === 'nursing'));
	const nursingCount = $derived(nursingEvents.length);
	const nursingTotalMs = $derived(
		nursingEvents.reduce(
			(sum, e) => sum + nursingDurationMs((e.details as NursingDetails).segments, store.nowMs),
			0
		)
	);

	const bottleEvents = $derived(store.events.filter((e) => e.type === 'bottle'));
	const bottleCount = $derived(bottleEvents.length);
	const bottleTotalMl = $derived(
		bottleEvents.reduce((sum, e) => sum + (e.details as BottleDetails).volumeMl, 0)
	);

	const diaperEvents = $derived(store.events.filter((e) => e.type === 'diaper'));
	const diaperPeeCount = $derived(
		diaperEvents.filter((e) => (e.details as DiaperDetails).pee).length
	);
	const diaperPooCount = $derived(
		diaperEvents.filter((e) => (e.details as DiaperDetails).poo).length
	);

	const sleepTotalMs = $derived(
		store.events
			.filter((e) => e.type === 'sleep' && e.endedAt !== null)
			.reduce((sum, e) => sum + Math.max(0, Date.parse(e.endedAt as string) - Date.parse(e.startedAt)), 0)
	);

	const hasAnything = $derived(
		nursingCount > 0 || bottleCount > 0 || diaperEvents.length > 0 || sleepTotalMs > 0
	);
</script>

{#if hasAnything}
	<Card.Root class="bg-surface-raised border-border border">
		<Card.Content class="flex flex-col gap-2">
			<div class="flex items-center gap-2">
				<ClipboardList size={20} class="text-ink-muted" aria-hidden="true" />
				<h2 class="text-ink font-semibold">Résumé du jour</h2>
			</div>
			<dl class="text-ink grid grid-cols-2 gap-x-4 gap-y-1 text-base tabular-nums">
				{#if nursingCount > 0}
					<dt class="text-ink-muted">Allaitement</dt>
					<dd>{nursingCount} · {formatElapsed(nursingTotalMs)}</dd>
				{/if}
				{#if bottleCount > 0}
					<dt class="text-ink-muted">Biberon</dt>
					<dd>{bottleCount} · {bottleTotalMl} ml</dd>
				{/if}
				{#if diaperEvents.length > 0}
					<dt class="text-ink-muted">Couches</dt>
					<dd>{diaperPeeCount} pipi, {diaperPooCount} caca</dd>
				{/if}
				{#if sleepTotalMs > 0}
					<dt class="text-ink-muted">Sommeil</dt>
					<dd>{formatElapsed(sleepTotalMs)}</dd>
				{/if}
			</dl>
		</Card.Content>
	</Card.Root>
{/if}
