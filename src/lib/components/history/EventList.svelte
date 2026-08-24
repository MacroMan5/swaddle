<script lang="ts">
	// Chronological (ascending) list of a day's events (FR-009). Rows are large
	// buttons opening the edit sheet; category is never color-only (icon + label).
	// Display rules live in ./eventDisplay so this list and the calendar grid
	// describe the same event the same way.
	import { formatElapsed, formatTimeOfDay } from '$lib/client/format';
	import {
		ICONS,
		TINTS,
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
	<ul class="flex flex-col gap-2">
		{#each events as event (event.id)}
			{@const Icon = ICONS[event.type]}
			{@const color = caregiverColor(event.caregiverId)}
			{@const cgName = caregiverName(event.caregiverId)}
			<li>
				<button
					type="button"
					data-testid="event-row"
					onclick={() => onSelect(event)}
					aria-label={rowAriaLabel(event, cgName)}
					class="border-border bg-surface-raised flex min-h-12 w-full items-center gap-3 rounded-control border px-3 py-2 text-left active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:scale-100"
				>
					<!-- Start over end, stacked: a single "07:15 – 07:40" line would eat a
					     third of the row at 375 px and squeeze the label out. -->
					<span class="w-14 shrink-0 text-base leading-tight tabular-nums" aria-hidden="true">
						<span class="text-ink block">{formatTimeOfDay(Date.parse(event.startedAt))}</span>
						{#if !isPointEvent(event)}
							<span class="text-ink-muted block">
								{event.endedAt === null
									? '…'
									: formatTimeOfDay(effectiveEndMs(event, nowMs))}
							</span>
						{/if}
					</span>
					<span class="{TINTS[event.type]} flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
						<Icon size={16} aria-hidden="true" />
					</span>
					<span class="text-ink min-w-0 flex-1 truncate text-base" aria-hidden="true">
						{#if startsBeforeDay(event, dayKey)}
							<span class="text-ink-muted">Depuis la veille · </span>
						{/if}
						{eventLabel(event, nowMs)}
						{#if endsAfterDay(event, dayKey)}
							<span class="text-ink-muted"> · → lendemain</span>
						{/if}
					</span>
					{#if color}
						<!-- The dot is color-only; the row's aria-label names the caregiver
					     so the information isn't lost for screen readers. -->
						<span
							class="h-3 w-3 shrink-0 rounded-full border border-border"
							style:background-color={color}
							aria-hidden="true"
						></span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
{/if}
