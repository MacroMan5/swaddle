<script lang="ts">
	// The whole day on one screen (FR-009): a 24 h grid, 480 px tall, no scroll
	// of its own. It is read for the *shape* of the day — the night, the gaps
	// between feeds, the long nap — not for detail. Detail lives in the
	// chronological list right below, which is also the reading that never
	// depends on colour perception (NFR-005).
	import { ChevronDown, ChevronUp } from '@lucide/svelte';
	import { formatElapsed, formatTimeOfDay } from '$lib/client/format';
	import { wallClockMinutesOf } from './timelinePosition';
	import {
		BLOCK_BARS,
		BLOCK_TONES,
		durationMs,
		effectiveEndMs,
		eventLabel,
		typeLabel
	} from './eventDisplay';
	import {
		DAY_HEIGHT_PX,
		HOUR_HEIGHT_PX,
		PX_PER_MIN,
		placeBlocks,
		placePoints,
		type Placed,
		type PlacedPoint
	} from './dayCalendarLayout';
	import type { EventDTO } from '$lib/client/types';

	let {
		events,
		dayKey,
		todayKey,
		nowMs,
		onSelect
	}: {
		// Already filtered and sorted by the page — the same array `EventList`
		// gets, so the category chips drive both views with no extra wiring.
		events: EventDTO[];
		dayKey: string;
		todayKey: string;
		nowMs: number;
		onSelect: (event: EventDTO) => void;
	} = $props();

	/** A block only carries text once it is tall enough to hold a line without
	 * clipping it — about 80 minutes here. Everything shorter is a bare bar; its
	 * name lives in `aria-label`, `title` and the list below. */
	const ONE_LINE_PX = 26;
	const TWO_LINE_PX = 46;

	/** Labelling every hour at 20 px/h would stack numbers on top of each other. */
	const LABEL_HOURS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
	const HOURS = Array.from({ length: 24 }, (_, h) => h);

	/** Point markers differ by shape as well as tint, so bottle and diaper stay
	 * distinguishable without colour — they are too small for an icon. */
	const POINT_SHAPES = {
		bottle: 'rounded-full bg-feed-500',
		diaper: 'rotate-45 bg-diaper-500'
	} as const;

	const blocks = $derived(placeBlocks(events, dayKey, nowMs));
	const points = $derived(placePoints(events, dayKey, nowMs));
	const isToday = $derived(dayKey === todayKey);
	const nowTopPx = $derived(wallClockMinutesOf(nowMs, dayKey) * PX_PER_MIN);

	function spanLabel(p: Placed): string {
		const startMs = Date.parse(p.event.startedAt);
		return p.open
			? `depuis ${formatTimeOfDay(startMs)}, en cours`
			: `de ${formatTimeOfDay(startMs)} à ${formatTimeOfDay(effectiveEndMs(p.event, nowMs))}`;
	}

	function blockAriaLabel(p: Placed): string {
		const parts = [typeLabel(p.event), spanLabel(p), formatElapsed(durationMs(p.event, nowMs))];
		if (p.clippedTop) parts.unshift('Depuis la veille');
		if (p.clippedBottom) parts.push('se poursuit le lendemain');
		return `${parts.join(', ')}.`;
	}

	function pointAriaLabel(point: PlacedPoint): string {
		return `${eventLabel(point.event, nowMs)}, à ${formatTimeOfDay(Date.parse(point.event.startedAt))}.`;
	}
</script>

<div class="border-border bg-surface-raised overflow-hidden rounded-card border p-2">
	<div class="relative" style:height="{DAY_HEIGHT_PX}px" data-testid="calendar-track">
		<!-- Hour rules and the axis: scaffolding, and noise for a screen reader. -->
		{#each HOURS as hour (hour)}
			<div
				class="absolute inset-x-0 border-t {LABEL_HOURS.includes(hour) || hour === 0
					? 'border-border'
					: 'border-border/40'}"
				style:top="{hour * HOUR_HEIGHT_PX}px"
				aria-hidden="true"
			></div>
		{/each}
		{#each LABEL_HOURS as hour (hour)}
			<!-- Sat on its rule with the surface behind it, so the line never
			     strikes through the number. -->
			<span
				class="text-ink-muted bg-surface-raised absolute left-0 w-8 -translate-y-1/2 pr-1 text-right text-base tabular-nums"
				style:top="{hour * HOUR_HEIGHT_PX}px"
				aria-hidden="true"
			>
				{String(hour).padStart(2, '0')}
			</span>
		{/each}

		<!-- Durational events -->
		<div class="absolute inset-y-0 left-8 right-5">
			{#each blocks as p (p.event.id)}
				{@const labelled = p.heightPx >= ONE_LINE_PX}
				<button
					type="button"
					data-testid="calendar-block"
					data-event-id={p.event.id}
					data-event-type={p.event.type}
					data-open={p.open ? 'true' : 'false'}
					onclick={() => onSelect(p.event)}
					aria-label={blockAriaLabel(p)}
					title={blockAriaLabel(p)}
					class="absolute overflow-hidden text-left leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary {labelled
						? `${BLOCK_TONES[p.event.type]} rounded-sm border-y border-r border-l-4 px-1`
						: `${BLOCK_BARS[p.event.type]} rounded-full`} {labelled && p.open
						? 'border-dashed'
						: ''} {p.clippedTop ? 'rounded-t-none' : ''} {p.clippedBottom ? 'rounded-b-none' : ''}"
					style:top="{p.topPx}px"
					style:height="{p.heightPx}px"
					style:left="calc({p.column} * 100% / {p.columns})"
					style:width="calc(100% / {p.columns})"
				>
					{#if labelled}
						<span class="flex items-center gap-1 text-base tabular-nums">
							{#if p.clippedTop}<ChevronUp size={12} class="shrink-0" aria-hidden="true" />{/if}
							<span class="truncate">
								{formatTimeOfDay(Date.parse(p.event.startedAt))} · {p.heightPx >= TWO_LINE_PX
									? eventLabel(p.event, nowMs)
									: typeLabel(p.event)}
							</span>
							{#if p.clippedBottom}<ChevronDown size={12} class="shrink-0" aria-hidden="true" />{/if}
						</span>
					{/if}
				</button>
			{/each}
		</div>

		<!-- Point events: no duration, so no height. Their own rail, so one diaper
		     change during a three-hour nap never squeezes that nap to half width. -->
		<div class="absolute inset-y-0 right-0 w-5">
			{#each points as point (point.event.id)}
				<button
					type="button"
					data-testid="calendar-point"
					data-event-id={point.event.id}
					data-event-type={point.event.type}
					onclick={() => onSelect(point.event)}
					aria-label={pointAriaLabel(point)}
					title={pointAriaLabel(point)}
					class="absolute inset-x-0 flex h-4 -translate-y-1/2 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
					style:top="{point.topPx}px"
				>
					<span
						class="{POINT_SHAPES[point.event.type as 'bottle' | 'diaper']} h-2.5 w-2.5"
						aria-hidden="true"
					></span>
				</button>
			{/each}
		</div>

		{#if isToday}
			<div
				class="pointer-events-none absolute inset-x-0 z-10 flex items-center"
				style:top="{nowTopPx}px"
				data-testid="calendar-now"
				aria-hidden="true"
			>
				<span class="bg-primary h-1.5 w-1.5 shrink-0 rounded-full"></span>
				<span class="bg-primary h-px flex-1"></span>
			</div>
		{/if}
	</div>
</div>
