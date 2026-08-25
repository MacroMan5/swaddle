<script lang="ts">
	import { getContext } from 'svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import { startTimer, ApiError } from '$lib/client/api';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import type { PumpSide } from '$lib/client/types';

	let {
		open = $bindable(false),
		babyId,
		caregiverId
	}: {
		open?: boolean;
		babyId: string | null;
		caregiverId: string | null;
	} = $props();

	const store = getContext<SyncStore>('sync');

	const SIDES: { value: PumpSide; label: string }[] = [
		{ value: 'left', label: 'Gauche' },
		{ value: 'right', label: 'Droite' },
		{ value: 'both', label: 'Les deux' }
	];

	let pending = $state(false);
	let error = $state<string | null>(null);

	async function start(side: PumpSide): Promise<void> {
		if (babyId === null || pending) return;
		pending = true;
		error = null;
		try {
			// {created:false} adopts an already-running session started elsewhere
			// (item 6): merge it in immediately either way, since that path emits
			// no SSE event.
			const result = await startTimer('pump', { babyId, caregiverId, side });
			store.applyServerEvent(result.event);
			open = false;
		} catch (e) {
			error = e instanceof ApiError ? e.userMessage : 'Une erreur est survenue.';
		} finally {
			pending = false;
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="bottom">
		<Sheet.Header class="border-border border-b-2">
			<p class="text-section text-ink-muted uppercase">Démarrer</p>
			<Sheet.Title>Tirage</Sheet.Title>
		</Sheet.Header>
		<div class="flex flex-col gap-4 px-4 pb-4">
			<div class="border-border divide-border grid grid-cols-3 divide-x-2 border-2">
				{#each SIDES as option (option.value)}
					<button
						type="button"
						disabled={pending || babyId === null}
						onclick={() => start(option.value)}
						class="bg-surface-raised text-ink flex h-[50px] items-center justify-start truncate px-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset disabled:opacity-50"
					>
						{option.label}
					</button>
				{/each}
			</div>
			{#if error}
				<p class="text-danger text-base" role="alert">{error}</p>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>
