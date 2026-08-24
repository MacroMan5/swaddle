<script lang="ts">
	// 7-column Mon–Sun week summary (FR-009/FR-010). Direct labels on the bars
	// (no detached legend), discreet gridlines, an accessible text summary.
	import { Baby, Droplets, Milk, Moon, Wind } from '@lucide/svelte';
	import { weeklySummary } from '$lib/client/summaries';
	import { formatElapsed } from '$lib/client/format';
	import type { EventDTO } from '$lib/client/types';

	let {
		events,
		mondayKey,
		todayKey,
		nowMs,
		onSelectDay
	}: {
		events: EventDTO[];
		mondayKey: string;
		todayKey: string;
		nowMs: number;
		onSelectDay: (dayKey: string) => void;
	} = $props();

	const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

	const week = $derived(weeklySummary(events, mondayKey, nowMs));

	// Duration-based lanes (nursing + sleep) drive the stacked bar height;
	// bottle/diaper are shown as direct-label counts under the bar (they have
	// no meaningful "height").
	const maxDurationMs = $derived(
		Math.max(1, ...week.days.map((d) => d.summary.nursing.totalMs + d.summary.sleep.totalMs))
	);

	function barHeightPct(dayKey: string): { nursing: number; sleep: number } {
		const day = week.days.find((d) => d.dayKey === dayKey)?.summary;
		if (!day) return { nursing: 0, sleep: 0 };
		return {
			nursing: (day.nursing.totalMs / maxDurationMs) * 100,
			sleep: (day.sleep.totalMs / maxDurationMs) * 100
		};
	}

	// Accessible summary includes every category (review item 9: pump was
	// missing) so a screen reader user gets the same information the direct
	// labels below give a sighted one.
	const summaryText = $derived(
		'Résumé de la semaine : ' +
			week.days
				.map((d) => {
					const s = d.summary;
					return (
						`${d.dayKey} — allaitement ${formatElapsed(s.nursing.totalMs)}, sommeil ${formatElapsed(s.sleep.totalMs)}, ` +
						`${s.bottle.count} biberon(s) (${s.bottle.totalMl} ml), ${s.pump.count} tire-lait(s) (${s.pump.totalMl} ml), ${s.diaper.count} couche(s)`
					);
				})
				.join(' ; ')
	);
</script>

<figure class="relative flex flex-col gap-2">
	<div class="border-border grid grid-cols-7 gap-1 border-t pt-3">
		{#each week.days as day, i (day.dayKey)}
			{@const heights = barHeightPct(day.dayKey)}
			{@const isToday = day.dayKey === todayKey}
			<button
				type="button"
				data-testid="week-col"
				onclick={() => onSelectDay(day.dayKey)}
				class="flex min-h-12 flex-col items-center gap-1 rounded-control px-1 py-2 text-center active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:scale-100 {isToday
					? 'bg-surface-raised'
					: ''}"
			>
				<span class="text-ink-muted text-base {isToday ? 'text-primary font-semibold' : ''}">
					{WEEKDAY_LABELS[i]}
				</span>
				<div class="bg-border relative flex h-24 w-6 flex-col-reverse overflow-hidden rounded-full">
					{#if heights.nursing > 0}
						<div class="bg-feed-500 relative w-full" style:height="{heights.nursing}%">
							<Baby size={10} class="text-on-primary absolute top-0.5 left-1/2 -translate-x-1/2" aria-hidden="true" />
						</div>
					{/if}
					{#if heights.sleep > 0}
						<div class="bg-sleep-500 relative w-full" style:height="{heights.sleep}%">
							<Moon size={10} class="text-on-primary absolute top-0.5 left-1/2 -translate-x-1/2" aria-hidden="true" />
						</div>
					{/if}
				</div>
				<!-- Direct value labels (review item 9): each nonzero metric gets its
				     own icon + value, so the bar's meaning never depends on color alone
				     and every number lives next to the bar, not in a separate legend. -->
				<div class="flex flex-col items-center gap-0.5">
					{#if day.summary.nursing.totalMs > 0}
						<span class="text-ink-muted flex items-center gap-1 text-base tabular-nums">
							<Baby size={12} aria-hidden="true" />{formatElapsed(day.summary.nursing.totalMs)}
						</span>
					{/if}
					{#if day.summary.sleep.totalMs > 0}
						<span class="text-ink-muted flex items-center gap-1 text-base tabular-nums">
							<Moon size={12} aria-hidden="true" />{formatElapsed(day.summary.sleep.totalMs)}
						</span>
					{/if}
					{#if day.summary.bottle.count > 0}
						<span class="text-ink flex items-center gap-1 text-base tabular-nums">
							<Milk size={12} aria-hidden="true" />{day.summary.bottle.totalMl} ml
						</span>
					{/if}
					{#if day.summary.pump.count > 0}
						<span class="text-ink-muted flex items-center gap-1 text-base tabular-nums">
							<Wind size={12} aria-hidden="true" />{day.summary.pump.totalMl} ml
						</span>
					{/if}
					{#if day.summary.diaper.count > 0}
						<span class="text-ink-muted flex items-center gap-1 text-base tabular-nums">
							<Droplets size={12} aria-hidden="true" />{day.summary.diaper.count}
						</span>
					{/if}
				</div>
			</button>
		{/each}
	</div>
	<figcaption class="sr-only">{summaryText}</figcaption>
</figure>
