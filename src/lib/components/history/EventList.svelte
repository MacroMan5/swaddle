<script lang="ts">
	// Chronological (ascending) list of a day's events (FR-009). Rows are large
	// buttons opening the edit sheet; category is never color-only (the label
	// names the type). Display rules live in ./eventDisplay so this list and the
	// calendar grid describe the same event the same way.
	import { page } from '$app/state';
	import { formatElapsed, formatTimeOfDay } from '$lib/client/format';
	import {
		BLOCK_BARS,
		durationMs,
		effectiveEndMs,
		endsAfterDay,
		eventLabel,
		isPointEvent,
		startsBeforeDay,
		typeLabel
	} from './eventDisplay';
	import type { CaregiverDTO, EventDTO } from '$lib/client/types';

	let {
		events,
		dayKey,
		nowMs,
		caregivers,
		onSelect
	}: {
		events: EventDTO[];
		dayKey: string;
		nowMs: number;
		caregivers: CaregiverDTO[];
		onSelect: (event: EventDTO) => void;
	} = $props();

	// The household's volume unit (#44) decorates stored millilitres only.
	const unit = $derived(page.data.volumeUnit);


	/** Stacked start/end reads as two bare times; the accessible name spells the
	 * span out so it is never heard as an ambiguous pair. */
	function rowAriaLabel(event: EventDTO, cgName: string | null): string {
		const startMs = Date.parse(event.startedAt);
		const parts = [typeLabel(event)];
		if (isPointEvent(event)) {
			parts.push(`à ${formatTimeOfDay(startMs)}`);
		} else if (event.endedAt === null) {
			parts.push(`depuis ${formatTimeOfDay(startMs)}, en cours`);
			parts.push(formatElapsed(durationMs(event, nowMs)));
		} else {
			parts.push(
				`de ${formatTimeOfDay(startMs)} à ${formatTimeOfDay(effectiveEndMs(event, nowMs))}`
			);
			parts.push(formatElapsed(durationMs(event, nowMs)));
		}
		if (startsBeforeDay(event, dayKey)) parts.unshift('Depuis la veille');
		if (endsAfterDay(event, dayKey)) parts.push('se poursuit le lendemain');
		if (cgName !== null) parts.push(`saisi par ${cgName}`);
		return `${parts.join(', ')}.`;
	}

	function caregiverColor(id: string | null): string | null {
		if (id === null) return null;
		return caregivers.find((c) => c.id === id)?.color ?? null;
	}

	function caregiverName(id: string | null): string | null {
		if (id === null) return null;
		return caregivers.find((c) => c.id === id)?.name ?? null;
	}
</script>

{#if events.length === 0}
	<p class="text-ink-muted p-4 text-center text-base">Aucune activité ce jour-là.</p>
{:else}
	<ul class="divide-border-hair bg-surface-raised flex flex-col divide-y">
		{#each events as event (event.id)}
			{@const color = caregiverColor(event.caregiverId)}
			{@const cgName = caregiverName(event.caregiverId)}
			<li>
				<button
					type="button"
					data-testid="event-row"
					onclick={() => onSelect(event)}
					aria-label={rowAriaLabel(event, cgName)}
					class="flex min-h-12 w-full items-center gap-2.5 px-2 py-2 text-left active:translate-y-px motion-reduce:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
				>
					<!-- Start over end, stacked: a single "07:15 – 07:40" line would eat a
					     third of the row at 375 px and squeeze the label out. -->
					<span class="text-row-time w-14 shrink-0 leading-tight tabular-nums" aria-hidden="true">
						<span class="text-ink block">{formatTimeOfDay(Date.parse(event.startedAt))}</span>
						{#if !isPointEvent(event)}
							<span class="text-ink-muted block">
								{event.endedAt === null ? '…' : formatTimeOfDay(effectiveEndMs(event, nowMs))}
							</span>
						{/if}
					</span>
					<span class="{BLOCK_BARS[event.type]} h-[22px] w-1 shrink-0" aria-hidden="true"></span>
					<span class="text-row text-ink min-w-0 flex-1 truncate" aria-hidden="true">
						{#if startsBeforeDay(event, dayKey)}
							<span class="text-ink-muted">Depuis la veille · </span>
						{/if}
						{eventLabel(event, nowMs, unit)}
						{#if endsAfterDay(event, dayKey)}
							<span class="text-ink-muted"> · → lendemain</span>
						{/if}
					</span>
					{#if color}
						<!-- The square is color-only; the row's aria-label names the caregiver
						     so the information isn't lost for screen readers. -->
						<span
							class="border-border size-2.5 shrink-0 border"
							style:background-color={color}
							aria-hidden="true"
						></span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
{/if}
