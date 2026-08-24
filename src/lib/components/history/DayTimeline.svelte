<script lang="ts">
	// Horizontal 24 h band, one lane per category (FR-009). Local hours; blocks
	// for durational events, ticks for point events. Category tint plus an icon
	// per lane, so lanes read without relying on color alone.
	import { Milk, Droplets, Moon } from '@lucide/svelte';
	import { formatElapsed, nursingDurationMs } from '$lib/client/format';
	import { wallClockMinutesOf } from './timelinePosition';
	import type { BottleDetails, EventDTO, NursingDetails } from '$lib/client/types';

	let { events, dayKey, nowMs }: { events: EventDTO[]; dayKey: string; nowMs: number } = $props();

	const LANES = [
		{ key: 'feed' as const, label: 'Alimentation', icon: Milk, bar: 'bg-feed-500', tint: 'bg-feed-100' },
		{ key: 'diaper' as const, label: 'Couche', icon: Droplets, bar: 'bg-diaper-500', tint: 'bg-diaper-100' },
		{ key: 'sleep' as const, label: 'Sommeil', icon: Moon, bar: 'bg-sleep-500', tint: 'bg-sleep-100' }
	];

	// DST-safe: positions read the wall clock directly (see timelinePosition.ts)
	// rather than dividing elapsed-minutes-since-midnight by a fixed 1440, which
	// drifts on a spring-forward (23 h) or fall-back (25 h) day (review item 8).
	function minutesOf(ms: number): number {
		return wallClockMinutesOf(ms, dayKey);
	}

	type Block = { id: string; startPct: number; widthPct: number; label: string; point: boolean };

	function blocksFor(lane: 'feed' | 'diaper' | 'sleep'): Block[] {
		return events
			.filter((e) => {
				if (lane === 'diaper') return e.type === 'diaper';
				if (lane === 'sleep') return e.type === 'sleep';
				return e.type === 'nursing' || e.type === 'bottle' || e.type === 'pump';
			})
			.map((e) => {
				const startMin = minutesOf(Date.parse(e.startedAt));
				const point = e.type === 'bottle' || e.type === 'diaper';
				const endMs = e.endedAt === null ? nowMs : Date.parse(e.endedAt);
				const endMin = point ? startMin : minutesOf(endMs);
				const widthPct = point ? 0.6 : Math.max(0.6, ((endMin - startMin) / 1440) * 100);
				return {
					id: e.id,
					startPct: (startMin / 1440) * 100,
					widthPct,
					label: blockLabel(e),
					point
				};
			});
	}

	function blockLabel(e: EventDTO): string {
		const time = new Date(Date.parse(e.startedAt));
		const hh = String(time.getHours()).padStart(2, '0');
		const mm = String(time.getMinutes()).padStart(2, '0');
		if (e.type === 'nursing') {
			const d = e.details as NursingDetails;
			return `Allaitement ${hh}:${mm}, ${formatElapsed(nursingDurationMs(d.segments, nowMs))}`;
		}
		if (e.type === 'bottle') {
			const d = e.details as BottleDetails;
			return `Biberon ${hh}:${mm}, ${d.volumeMl} ml`;
		}
		return `${hh}:${mm}`;
	}

	const summaryText = $derived.by(() => {
		const parts: string[] = [];
		for (const lane of LANES) {
			const count = blocksFor(lane.key).length;
			if (count > 0) parts.push(`${lane.label} : ${count}`);
		}
		return parts.length > 0
			? `Chronologie du ${dayKey} — ${parts.join(', ')}.`
			: `Chronologie du ${dayKey} — aucune activité.`;
	});
</script>

<div role="img" aria-label={summaryText} class="flex flex-col gap-2">
	{#each LANES as lane (lane.key)}
		<div class="flex items-center gap-2">
			<span class="{lane.tint} flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
				<lane.icon size={16} class="text-ink" aria-hidden="true" />
			</span>
			<div class="border-border bg-surface-raised relative h-8 flex-1 overflow-hidden rounded-control border">
				{#each blocksFor(lane.key) as block (block.id)}
					<div
						title={block.label}
						class="{lane.bar} absolute top-1 bottom-1 rounded-full {block.point ? 'w-1.5' : ''}"
						style:left="{block.startPct}%"
						style:width={block.point ? undefined : `${block.widthPct}%`}
					></div>
				{/each}
			</div>
		</div>
	{/each}
</div>
