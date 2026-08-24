<script lang="ts">
	// 7-column Mon–Sun week summary (FR-009/FR-010). Direct labels on the bars
	// (no detached legend), discreet gridlines, an accessible text summary.
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

	const summaryText = $derived(
		'Résumé de la semaine : ' +
			week.days
				.map((d) => {
					const s = d.summary;
					return `${d.dayKey} — allaitement ${formatElapsed(s.nursing.totalMs)}, sommeil ${formatElapsed(s.sleep.totalMs)}, ${s.bottle.count} biberon(s), ${s.diaper.count} couche(s)`;
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
				<div class="bg-border flex h-24 w-6 flex-col-reverse overflow-hidden rounded-full">
					<div class="bg-feed-500 w-full" style:height="{heights.nursing}%"></div>
					<div class="bg-sleep-500 w-full" style:height="{heights.sleep}%"></div>
				</div>
				<span class="text-ink text-base tabular-nums">{day.summary.bottle.totalMl} ml</span>
				{#if day.summary.diaper.count > 0}
					<span class="text-ink-muted text-base tabular-nums">{day.summary.diaper.count} couches</span>
				{/if}
			</button>
		{/each}
	</div>
	<figcaption class="sr-only">{summaryText}</figcaption>
</figure>
