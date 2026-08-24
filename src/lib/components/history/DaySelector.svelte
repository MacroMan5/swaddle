<script lang="ts">
	// Full-width day navigator band (FR-009), replacing the floating « ◀ date ▶ »
	// row. `dayKey` is `YYYY-MM-DD` local.
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import { localDayKey } from '$lib/client/summaries';

	let {
		dayKey,
		todayKey,
		onChange
	}: { dayKey: string; todayKey: string; onChange: (nextDayKey: string) => void } = $props();

	const formatter = new Intl.DateTimeFormat('fr-CA', {
		weekday: 'long',
		day: 'numeric',
		month: 'long'
	});

	function shiftDay(delta: number): string {
		const [y, m, d] = dayKey.split('-').map(Number);
		return localDayKey(new Date(y, m - 1, d + delta));
	}

	const isToday = $derived(dayKey === todayKey);
	const label = $derived.by(() => {
		const [y, m, d] = dayKey.split('-').map(Number);
		return formatter.format(new Date(y, m - 1, d));
	});

	const chevronCell =
		'text-ink flex min-h-13 w-13 shrink-0 items-center justify-center active:translate-y-px motion-reduce:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset disabled:opacity-30';
</script>

<div class="border-border divide-border-hair flex items-stretch divide-x border-b-2">
	<button
		type="button"
		aria-label="Jour précédent"
		onclick={() => onChange(shiftDay(-1))}
		class={chevronCell}
	>
		<ChevronLeft size={22} aria-hidden="true" />
	</button>
	<div class="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2">
		{#if isToday}
			<span class="text-category text-primary-text uppercase">Aujourd’hui</span>
		{/if}
		<span class="text-field text-ink truncate capitalize">{label}</span>
	</div>
	<button
		type="button"
		aria-label="Jour suivant"
		disabled={isToday}
		onclick={() => onChange(shiftDay(1))}
		class={chevronCell}
	>
		<ChevronRight size={22} aria-hidden="true" />
	</button>
</div>
