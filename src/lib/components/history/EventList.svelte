<script lang="ts">
	// Chronological (ascending) list of a day's events (FR-009). Rows are large
	// buttons opening the edit sheet; category is never color-only (icon + label).
	import { Baby, Droplets, Milk, Moon, Wind } from '@lucide/svelte';
	import { localDayKey } from '$lib/client/summaries';
	import { formatElapsed, nursingDurationMs } from '$lib/client/format';
	import type {
		BottleDetails,
		CaregiverDTO,
		DiaperDetails,
		EventDTO,
		NursingDetails,
		PumpDetails
	} from '$lib/client/types';

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

	const ICONS = { nursing: Baby, bottle: Milk, pump: Wind, diaper: Droplets, sleep: Moon } as const;
	const TINTS = {
		nursing: 'bg-feed-100 text-feed-700',
		bottle: 'bg-feed-100 text-feed-700',
		pump: 'bg-feed-100 text-feed-700',
		diaper: 'bg-diaper-100 text-diaper-700',
		sleep: 'bg-sleep-100 text-sleep-700'
	} as const;

	function timeLabel(iso: string): string {
		const d = new Date(Date.parse(iso));
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	function endsAfterDay(event: EventDTO): boolean {
		if (event.endedAt === null) return false;
		return localDayKey(new Date(Date.parse(event.endedAt))) !== dayKey;
	}

	/** True for a carry-over row (review item 2): the event overlaps `dayKey`
	 * but actually started the day before — its displayed clock time reads
	 * "yesterday", so the row needs its own hint alongside `endsAfterDay`'s. */
	function startsBeforeDay(event: EventDTO): boolean {
		return localDayKey(new Date(Date.parse(event.startedAt))) !== dayKey;
	}

	function diaperLabel(details: DiaperDetails): string {
		if (details.pee && details.poo) return 'Pipi et caca';
		if (details.poo) return 'Caca';
		return 'Pipi';
	}

	function nursingSides(details: NursingDetails): string {
		const sides = new Set(details.segments.map((s) => s.side));
		const parts: string[] = [];
		if (sides.has('left')) parts.push('G');
		if (sides.has('right')) parts.push('D');
		return parts.join('+');
	}

	function label(event: EventDTO): string {
		switch (event.type) {
			case 'bottle': {
				const d = event.details as BottleDetails;
				return `Biberon · ${d.volumeMl} ml`;
			}
			case 'nursing': {
				const d = event.details as NursingDetails;
				const durationMs = nursingDurationMs(d.segments, nowMs);
				return `Allaitement · ${formatElapsed(durationMs)} · ${nursingSides(d)}`;
			}
			case 'pump': {
				const d = event.details as PumpDetails;
				return d.volumeMl === null ? 'Tire-lait · en cours' : `Tire-lait · ${d.volumeMl} ml`;
			}
			case 'diaper': {
				const d = event.details as DiaperDetails;
				return `Couche · ${diaperLabel(d)}`;
			}
			case 'sleep': {
				const end = event.endedAt === null ? nowMs : Date.parse(event.endedAt);
				const durationMs = Math.max(0, end - Date.parse(event.startedAt));
				return `Sommeil · ${formatElapsed(durationMs)}`;
			}
		}
	}

	function caregiverColor(id: string | null): string | null {
		if (id === null) return null;
		return caregivers.find((c) => c.id === id)?.color ?? null;
	}
</script>

{#if events.length === 0}
	<p class="text-ink-muted p-4 text-center text-base">Aucune activité ce jour-là.</p>
{:else}
	<ul class="flex flex-col gap-2">
		{#each events as event (event.id)}
			{@const Icon = ICONS[event.type]}
			{@const color = caregiverColor(event.caregiverId)}
			<li>
				<button
					type="button"
					data-testid="event-row"
					onclick={() => onSelect(event)}
					class="border-border bg-surface-raised flex min-h-12 w-full items-center gap-3 rounded-control border px-3 py-2 text-left active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:scale-100"
				>
					<span class="text-ink w-12 shrink-0 text-base tabular-nums">{timeLabel(event.startedAt)}</span>
					<span class="{TINTS[event.type]} flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
						<Icon size={16} aria-hidden="true" />
					</span>
					<span class="text-ink min-w-0 flex-1 truncate text-base">
						{#if startsBeforeDay(event)}
							<span class="text-ink-muted">Depuis la veille · </span>
						{/if}
						{label(event)}
						{#if endsAfterDay(event)}
							<span class="text-ink-muted"> · → lendemain</span>
						{/if}
					</span>
					{#if color}
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
