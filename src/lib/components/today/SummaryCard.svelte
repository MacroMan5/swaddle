<script lang="ts">
	// Light daily aggregate (FR-008): counts and totals only. Per-event detail and
	// editing stay in slice 4's history screen. Backed by the same `dailySummary`
	// engine as the history day view, so the two screens never disagree
	// (FR-010): duration-based metrics (nursing, sleep) are day-split.
	import { getContext } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import { ClipboardList } from '@lucide/svelte';
	import { formatElapsed } from '$lib/client/format';
	import { dailySummary, localDayKey } from '$lib/client/summaries';
	import type { SyncStore } from '$lib/client/sync.svelte';

	const store = getContext<SyncStore>('sync');

	const todayKey = $derived(localDayKey(new Date(store.nowMs)));
	const summary = $derived(dailySummary(store.events, todayKey, store.nowMs));

	const hasAnything = $derived(
		summary.nursing.count > 0 ||
			summary.bottle.count > 0 ||
			summary.pump.count > 0 ||
			summary.diaper.count > 0 ||
			summary.sleep.totalMs > 0
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
				{#if summary.nursing.count > 0}
					<dt class="text-ink-muted">Allaitement</dt>
					<dd>{summary.nursing.count} · {formatElapsed(summary.nursing.totalMs)}</dd>
				{/if}
				{#if summary.bottle.count > 0}
					<dt class="text-ink-muted">Biberon</dt>
					<dd>{summary.bottle.count} · {summary.bottle.totalMl} ml</dd>
				{/if}
				{#if summary.pump.count > 0}
					<dt class="text-ink-muted">Tire-lait</dt>
					<dd>{summary.pump.count} · {summary.pump.totalMl} ml</dd>
				{/if}
				{#if summary.diaper.count > 0}
					<dt class="text-ink-muted">Couches</dt>
					<dd>{summary.diaper.pee} pipi, {summary.diaper.poo} caca</dd>
				{/if}
				{#if summary.sleep.totalMs > 0}
					<dt class="text-ink-muted">Sommeil</dt>
					<dd>{formatElapsed(summary.sleep.totalMs)}</dd>
				{/if}
			</dl>
		</Card.Content>
	</Card.Root>
{/if}
