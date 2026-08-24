<script lang="ts">
	// 7-column Mon–Sun week summary (FR-009/FR-010): direct labels on the bars
	// (no detached legend), a week-over-week comparison and 7-day averages, and
	// an accessible text summary carrying everything the visuals do.
	import { signedDeltaLabel, weeklySummary, weekTotals } from '$lib/client/summaries';
	import { formatElapsed } from '$lib/client/format';
	import type { EventDTO } from '$lib/client/types';

	let {
		events,
		prevEvents,
		mondayKey,
		prevMondayKey,
		todayKey,
		nowMs,
		onSelectDay
	}: {
		events: EventDTO[];
		// null while the previous week hasn't loaded (or failed): the comparison
		// block simply doesn't render rather than comparing against zeros.
		prevEvents: EventDTO[] | null;
		mondayKey: string;
		prevMondayKey: string;
		todayKey: string;
		nowMs: number;
		onSelectDay: (dayKey: string) => void;
	} = $props();

	const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

	const week = $derived(weeklySummary(events, mondayKey, nowMs));
	const totals = $derived(weekTotals(week));
	const prevTotals = $derived(
		prevEvents === null ? null : weekTotals(weeklySummary(prevEvents, prevMondayKey, nowMs))
	);

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

	function minutesLabel(ms: number): string {
		return `${Math.round(ms / 60_000)} min`;
	}

	const frDecimal = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1 });

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

	const AVERAGES = $derived([
		{ label: 'Sommeil / jour', bar: 'bg-sleep-700', value: formatElapsed(totals.sleepMs / 7) },
		{
			label: 'Allaitement / jour',
			bar: 'bg-feed-700',
			value: formatElapsed(totals.nursingMs / 7)
		},
		{
			label: 'Biberons / jour',
			bar: 'bg-feed-700',
			value: `${Math.round(totals.bottleMl / 7)} ml`
		},
		{
			label: 'Couches / jour',
			bar: 'bg-diaper-700',
			value: frDecimal.format(totals.diaperCount / 7)
		}
	]);
</script>

<figure class="relative flex flex-col gap-4">
	<div
		class="border-t-border-hair border-b-border divide-border-hair grid grid-cols-7 divide-x border-t border-b-2 py-2"
	>
		{#each week.days as day, i (day.dayKey)}
			{@const heights = barHeightPct(day.dayKey)}
			{@const isToday = day.dayKey === todayKey}
			<button
				type="button"
				data-testid="week-col"
				onclick={() => onSelectDay(day.dayKey)}
				class="flex min-h-12 flex-col items-center gap-1.5 px-1 py-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
			>
				<span class="text-section {isToday ? 'text-primary-text' : 'text-ink-muted'}">
					{WEEKDAY_LABELS[i]}
				</span>
				<div class="bg-surface flex h-[150px] w-4 flex-col-reverse overflow-hidden">
					{#if heights.sleep > 0}
						<div class="bg-sleep-700 w-full" style:height="{heights.sleep}%"></div>
					{/if}
					{#if heights.nursing > 0}
						<div class="bg-feed-700 w-full" style:height="{heights.nursing}%"></div>
					{/if}
				</div>
				<span class="text-section text-ink flex flex-col items-center gap-0.5 tabular-nums">
					{#if day.summary.nursing.totalMs + day.summary.sleep.totalMs > 0}
						<span>{formatElapsed(day.summary.nursing.totalMs + day.summary.sleep.totalMs)}</span>
					{/if}
					{#if day.summary.bottle.count > 0}
						<span>{day.summary.bottle.totalMl} ml</span>
					{/if}
					{#if day.summary.diaper.count > 0}
						<span class="text-ink-muted">{day.summary.diaper.count} c.</span>
					{/if}
				</span>
			</button>
		{/each}
	</div>

	{#if prevTotals !== null}
		<section class="flex flex-col gap-2">
			<h2 class="text-section text-ink-muted uppercase">Semaine précédente</h2>
			<div class="border-border divide-border-hair grid grid-cols-3 divide-x border-2">
				<div class="flex flex-col gap-1 px-2 py-3">
					<span class="text-category text-sleep-700 uppercase">Sommeil</span>
					<span class="text-delta text-ink tabular-nums"
						>{signedDeltaLabel(totals.sleepMs, prevTotals.sleepMs, minutesLabel)}</span
					>
				</div>
				<div class="flex flex-col gap-1 px-2 py-3">
					<span class="text-category text-feed-700 uppercase">Tétées</span>
					<span class="text-delta text-ink tabular-nums"
						>{signedDeltaLabel(totals.nursingCount, prevTotals.nursingCount)}</span
					>
				</div>
				<div class="flex flex-col gap-1 px-2 py-3">
					<span class="text-category text-diaper-700 uppercase">Couches</span>
					<span class="text-delta text-ink tabular-nums"
						>{signedDeltaLabel(totals.diaperCount, prevTotals.diaperCount)}</span
					>
				</div>
			</div>
		</section>
	{/if}

	<section class="border-border flex flex-col gap-1 border-t-2 pt-3">
		<h2 class="text-section text-ink-muted uppercase">Moyennes sur 7 jours</h2>
		<dl class="divide-border-hair divide-y">
			{#each AVERAGES as row (row.label)}
				<div class="flex items-center justify-between gap-4 py-2">
					<dt class="text-label text-ink-label flex items-center gap-2">
						<span class="h-4 w-1 shrink-0 {row.bar}" aria-hidden="true"></span>
						{row.label}
					</dt>
					<dd class="text-value text-ink tabular-nums">{row.value}</dd>
				</div>
			{/each}
		</dl>
	</section>

	<figcaption class="sr-only">{summaryText}</figcaption>
</figure>
