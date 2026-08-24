<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import { startTimer, ApiError } from '$lib/client/api';
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
			await startTimer('pump', { babyId, caregiverId, side });
			open = false;
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Une erreur est survenue.';
		} finally {
			pending = false;
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="bottom">
		<Sheet.Header>
			<Sheet.Title>Tirage</Sheet.Title>
		</Sheet.Header>
		<div class="flex flex-col gap-4 px-4 pb-4">
			<div class="grid grid-cols-3 gap-2">
				{#each SIDES as option (option.value)}
					<button
						type="button"
						disabled={pending || babyId === null}
						onclick={() => start(option.value)}
						class="border-border bg-surface-raised text-ink min-h-12 rounded-control border px-2 py-2 font-medium active:scale-[0.97] disabled:opacity-50 motion-reduce:active:scale-100"
					>
						{option.label}
					</button>
				{/each}
			</div>
			{#if error}
				<p class="text-danger text-sm" role="alert">{error}</p>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>
