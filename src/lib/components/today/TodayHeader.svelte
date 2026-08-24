<script lang="ts">
	import { getContext } from 'svelte';
	import { formatBabyAge } from '$lib/client/babyAge';
	import type { SyncStore } from '$lib/client/sync.svelte';

	let { babyName, birthdate }: { babyName: string | null; birthdate: string | null } = $props();

	const store = getContext<SyncStore>('sync');

	const ageLabel = $derived(birthdate === null ? null : formatBabyAge(birthdate, store.nowMs));
</script>

<header class="border-border flex items-end justify-between gap-4 border-b-2 pb-3">
	<h1 class="text-screen-title text-ink">Aujourd’hui</h1>
	{#if babyName !== null}
		<div class="flex flex-col items-end gap-1">
			<span class="text-section text-ink-muted uppercase">{babyName}</span>
			{#if ageLabel !== null}
				<span class="text-meta text-ink tabular-nums">{ageLabel}</span>
			{/if}
		</div>
	{/if}
</header>
