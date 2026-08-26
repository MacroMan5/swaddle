<script lang="ts">
	// Light daily aggregate (FR-008): counts and totals only, anchored at the
	// bottom of the screen. Backed by the same `dailySummary` engine as the
	// history views, so the screens never disagree (FR-010): duration-based
	// metrics (nursing, sleep) are day-split.
	import { getContext } from 'svelte';
	import {
		dailySummary,
		formatNursingSummary,
		formatSleepSummary,
		hasNursingActivity,
		localDayKey
	} from '$lib/client/summaries';
	import type { SyncStore } from '$lib/client/sync.svelte';

	const store = getContext<SyncStore>('sync');

	const todayKey = $derived(localDayKey(new Date(store.nowMs)));
	const summary = $derived(dailySummary(store.events, todayKey, store.nowMs));

	const hasAnything = $derived(
		hasNursingActivity(summary.nursing) ||
			summary.bottle.count > 0 ||
			summary.pump.count > 0 ||
			summary.diaper.count > 0 ||
			summary.sleep.totalMs > 0
	);

	const dateLabel = $derived(
		new Date(store.nowMs).toLocaleDateString('fr-CA', {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		})
	);
</script>

{#if hasAnything}
	<section class="border-border mt-auto flex flex-col gap-1 border-t-2 pt-3">
		<div class="flex items-baseline justify-between gap-4">
			<h2 class="text-section text-ink-muted uppercase">Résumé du jour</h2>
			<span class="text-meta text-ink-muted">{dateLabel}</span>
		</div>
		<dl class="divide-border-hair divide-y">
			{#if hasNursingActivity(summary.nursing)}
				<div class="flex items-baseline justify-between gap-4 py-2">
					<dt class="text-label text-ink-label">Allaitement</dt>
					<dd class="text-value text-ink tabular-nums">{formatNursingSummary(summary.nursing)}</dd>
				</div>
			{/if}
			{#if summary.bottle.count > 0}
				<div data-testid="bottle-summary" class="flex items-baseline justify-between gap-4 py-2">
					<dt class="text-label text-ink-label">Biberon</dt>
					<dd class="text-value text-ink tabular-nums">
						{summary.bottle.count} · {summary.bottle.totalMl} ml
					</dd>
				</div>
			{/if}
			{#if summary.pump.count > 0}
				<div class="flex items-baseline justify-between gap-4 py-2">
					<dt class="text-label text-ink-label">Tire-lait</dt>
					<dd class="text-value text-ink tabular-nums">
						{summary.pump.count} · {summary.pump.totalMl} ml
					</dd>
				</div>
			{/if}
			{#if summary.diaper.count > 0}
				<div class="flex items-baseline justify-between gap-4 py-2">
					<dt class="text-label text-ink-label">Couches</dt>
					<dd class="text-value text-ink tabular-nums">
						{summary.diaper.pee} pipi, {summary.diaper.poo} caca
					</dd>
				</div>
			{/if}
			{#if summary.sleep.totalMs > 0}
				<div class="flex items-baseline justify-between gap-4 py-2">
					<dt class="text-label text-ink-label">Sommeil</dt>
					<dd class="text-value text-ink tabular-nums">{formatSleepSummary(summary.sleep)}</dd>
				</div>
			{/if}
		</dl>
	</section>
{/if}
