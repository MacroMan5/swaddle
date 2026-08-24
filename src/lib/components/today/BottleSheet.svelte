<script lang="ts">
	import { getContext } from 'svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import { LoaderCircle } from '@lucide/svelte';
	import { createEvent, deleteEvent, ApiError } from '$lib/client/api';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import type { MilkType } from '$lib/client/types';

	let {
		open = $bindable(false),
		babyId,
		caregiverId,
		onSaved
	}: {
		open?: boolean;
		babyId: string | null;
		caregiverId: string | null;
		onSaved: (id: string, message: string, onUndo: () => Promise<void>) => void;
	} = $props();

	const store = getContext<SyncStore>('sync');

	const MILK_TYPES: { value: MilkType; label: string }[] = [
		{ value: 'breast', label: 'Maternel' },
		{ value: 'formula', label: 'Préparation' },
		{ value: 'mixed', label: 'Mixte' }
	];

	let milkType = $state<MilkType>('breast');
	let volume = $state('');
	let time = $state('');
	let pending = $state(false);
	let volumeError = $state<string | null>(null);
	let timeError = $state<string | null>(null);
	let formError = $state<string | null>(null);

	const isDirty = $derived(volume.trim() !== '');

	function lastMilkType(): MilkType {
		const stored =
			typeof localStorage === 'undefined' ? null : localStorage.getItem('swaddle.lastMilkType');
		return stored === 'breast' || stored === 'formula' || stored === 'mixed' ? stored : 'breast';
	}

	function toLocalInputValue(date: Date): string {
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}

	$effect(() => {
		if (open) {
			milkType = lastMilkType();
			volume = '';
			// Server-corrected clock (RISK-001), not the raw device clock.
			time = toLocalInputValue(new Date(store.nowMs));
			volumeError = null;
			timeError = null;
			formError = null;
		}
	});

	function handleOpenChange(next: boolean): void {
		if (!next && isDirty) {
			const confirmed =
				typeof confirm === 'undefined' || confirm('Fermer sans enregistrer le biberon ?');
			if (!confirmed) return;
		}
		open = next;
	}

	async function submit(): Promise<void> {
		if (babyId === null || pending) return;
		pending = true;
		volumeError = null;
		timeError = null;
		formError = null;
		const volumeMl = Number(volume);
		let event;
		try {
			event = await createEvent({
				babyId,
				caregiverId,
				type: 'bottle',
				startedAt: new Date(time).toISOString(),
				details: { milkType, volumeMl }
			});
		} catch (e) {
			pending = false;
			if (e instanceof ApiError && e.issues.length > 0) {
				for (const issue of e.issues) {
					if (issue.path.endsWith('volumeMl')) volumeError = issue.message;
					else if (issue.path.endsWith('startedAt')) timeError = issue.message;
					else formError = issue.message;
				}
			} else {
				formError = e instanceof ApiError ? e.message : 'Une erreur est survenue.';
			}
			return;
		}
		pending = false;
		// Merge the confirmed write immediately: correct even if SSE is down (item 6).
		store.applyServerEvent(event);
		localStorage.setItem('swaddle.lastMilkType', milkType);
		open = false;
		const savedEvent = event;
		onSaved(savedEvent.id, 'Biberon enregistré', async () => {
			const deleted = await deleteEvent(savedEvent.id);
			store.applyServerEvent(deleted);
		});
	}
</script>

<Sheet.Root {open} onOpenChange={handleOpenChange}>
	<Sheet.Content side="bottom">
		<Sheet.Header>
			<Sheet.Title>Biberon</Sheet.Title>
		</Sheet.Header>
		<div class="flex flex-col gap-4 px-4 pb-4">
			{#if formError}
				<p class="text-danger text-base" role="alert">{formError}</p>
			{/if}
			<div class="flex flex-col gap-2">
				<span id="milk-type-label" class="text-base font-medium text-ink">Type de lait</span>
				<div class="grid grid-cols-3 gap-2" role="group" aria-labelledby="milk-type-label">
					{#each MILK_TYPES as option (option.value)}
						<button
							type="button"
							aria-pressed={milkType === option.value}
							onclick={() => (milkType = option.value)}
							class="min-h-12 rounded-control border px-2 py-2 font-medium active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:scale-100 {milkType ===
							option.value
								? 'border-feed-500 bg-feed-100 text-feed-700'
								: 'border-border bg-surface-raised text-ink-muted'}"
						>
							{option.label}
						</button>
					{/each}
				</div>
			</div>
			<div class="flex flex-col gap-2">
				<label for="bottle-volume" class="text-base font-medium text-ink">Volume (ml)</label>
				<input
					id="bottle-volume"
					inputmode="decimal"
					bind:value={volume}
					aria-invalid={volumeError !== null}
					aria-describedby={volumeError !== null ? 'bottle-volume-error' : undefined}
					class="border-border bg-surface-raised min-h-12 rounded-control border px-3 py-2 text-base tabular-nums {volumeError
						? 'border-danger'
						: ''}"
				/>
				{#if volumeError}
					<p id="bottle-volume-error" class="text-danger text-base" role="alert">{volumeError}</p>
				{/if}
			</div>
			<div class="flex flex-col gap-2">
				<label for="bottle-time" class="text-base font-medium text-ink">Heure</label>
				<input
					id="bottle-time"
					type="datetime-local"
					bind:value={time}
					aria-invalid={timeError !== null}
					aria-describedby={timeError !== null ? 'bottle-time-error' : undefined}
					class="border-border bg-surface-raised min-h-12 rounded-control border px-3 py-2 text-base {timeError
						? 'border-danger'
						: ''}"
				/>
				{#if timeError}
					<p id="bottle-time-error" class="text-danger text-base" role="alert">{timeError}</p>
				{/if}
			</div>
			<button
				type="button"
				disabled={pending || babyId === null}
				onclick={submit}
				class="bg-primary text-on-primary flex min-h-12 items-center justify-center gap-2 rounded-control px-4 py-2 font-semibold active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:active:scale-100"
			>
				{#if pending}
					<LoaderCircle size={18} class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
				{/if}
				{pending ? 'Enregistrement…' : 'Enregistrer'}
			</button>
		</div>
	</Sheet.Content>
</Sheet.Root>
