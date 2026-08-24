<script lang="ts">
	import { getContext } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import { Moon } from '@lucide/svelte';
	import { startTimer, ApiError } from '$lib/client/api';
	import { formatElapsed } from '$lib/client/format';
	import type { SyncStore } from '$lib/client/sync.svelte';

	let { babyId, caregiverId }: { babyId: string | null; caregiverId: string | null } = $props();

	const store = getContext<SyncStore>('sync');

	let pending = $state(false);
	let error = $state<string | null>(null);

	const activeSleep = $derived(store.timers.find((t) => t.type === 'sleep'));

	const lastSleep = $derived(
		store.events.find((e) => e.type === 'sleep' && e.endedAt !== null)
	);
	const todayCount = $derived(
		store.events.filter((e) => e.type === 'sleep' && e.endedAt !== null).length
	);

	const lastSleepLabel = $derived.by(() => {
		const event = lastSleep;
		if (!event) return null;
		const elapsed = formatElapsed(store.nowMs - Date.parse(event.startedAt));
		return `Sommeil · il y a ${elapsed}`;
	});

	async function start(): Promise<void> {
		if (babyId === null || pending) return;
		pending = true;
		error = null;
		try {
			await startTimer('sleep', { babyId, caregiverId });
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Une erreur est survenue.';
		} finally {
			pending = false;
		}
	}
</script>

<Card.Root class="bg-sleep-100 border-0">
	<Card.Content class="flex flex-col gap-3">
		<div class="flex items-center gap-2">
			<Moon size={20} class="text-sleep-700" aria-hidden="true" />
			<h2 class="text-sleep-700 font-semibold">Sommeil</h2>
		</div>
		<p class="text-ink-muted tabular-nums text-sm">
			{lastSleepLabel ?? 'Aucun sommeil aujourd’hui'}
		</p>
		{#if todayCount > 0}
			<p class="text-ink-muted tabular-nums text-xs">
				{todayCount} sommeil{todayCount > 1 ? 's' : ''} aujourd’hui
			</p>
		{/if}
		{#if activeSleep}
			<p class="text-ink-muted text-sm">En cours · voir en haut</p>
		{:else}
			<button
				type="button"
				disabled={pending || babyId === null}
				onclick={start}
				class="bg-surface-raised text-sleep-700 min-h-12 rounded-control px-4 py-2 font-medium active:scale-[0.97] disabled:opacity-50 motion-reduce:active:scale-100"
			>
				Commencer le sommeil
			</button>
		{/if}
		{#if error}
			<p class="text-danger text-sm" role="alert">{error}</p>
		{/if}
	</Card.Content>
</Card.Root>
