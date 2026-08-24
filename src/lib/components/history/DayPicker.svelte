<script lang="ts">
	// « ◀ / date / ▶ » day navigator (FR-009). `dayKey` is `YYYY-MM-DD` local.
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
		const formatted = formatter.format(new Date(y, m - 1, d));
		return isToday ? `Aujourd’hui · ${formatted}` : formatted;
	});
</script>

<div class="flex items-center justify-between gap-2">
	<button
		type="button"
		aria-label="Jour précédent"
		onclick={() => onChange(shiftDay(-1))}
		class="border-border bg-surface-raised text-ink flex min-h-12 min-w-12 items-center justify-center rounded-control border active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:scale-100"
	>
		<ChevronLeft size={22} aria-hidden="true" />
	</button>
	<p class="text-ink flex-1 text-center text-lg font-semibold capitalize">{label}</p>
	<button
		type="button"
		aria-label="Jour suivant"
		disabled={isToday}
		onclick={() => onChange(shiftDay(1))}
		class="border-border bg-surface-raised text-ink flex min-h-12 min-w-12 items-center justify-center rounded-control border active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40 motion-reduce:active:scale-100"
	>
		<ChevronRight size={22} aria-hidden="true" />
	</button>
</div>
