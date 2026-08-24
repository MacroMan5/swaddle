<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import { createEvent, deleteEvent, ApiError } from '$lib/client/api';
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
		onSaved: (message: string, onUndo: () => void) => void;
	} = $props();

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
			time = toLocalInputValue(new Date());
			volumeError = null;
		}
	});

	async function submit(): Promise<void> {
		if (babyId === null || pending) return;
		pending = true;
		volumeError = null;
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
			if (e instanceof ApiError) {
				const issue = e.issues.find((i) => i.path.endsWith('volumeMl'));
				volumeError = issue?.message ?? e.message;
			} else {
				volumeError = 'Une erreur est survenue.';
			}
			return;
		}
		pending = false;
		localStorage.setItem('swaddle.lastMilkType', milkType);
		open = false;
		const savedEvent = event;
		onSaved('Biberon enregistré', () => {
			void deleteEvent(savedEvent.id);
		});
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="bottom">
		<Sheet.Header>
			<Sheet.Title>Biberon</Sheet.Title>
		</Sheet.Header>
		<div class="flex flex-col gap-4 px-4 pb-4">
			<div class="flex flex-col gap-2">
				<span id="milk-type-label" class="text-sm font-medium text-ink">Type de lait</span>
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
				<label for="bottle-volume" class="text-sm font-medium text-ink">Volume (ml)</label>
				<input
					id="bottle-volume"
					inputmode="decimal"
					bind:value={volume}
					class="border-border bg-surface-raised min-h-12 rounded-control border px-3 py-2 text-base tabular-nums"
				/>
				{#if volumeError}
					<p class="text-danger text-sm" role="alert">{volumeError}</p>
				{/if}
			</div>
			<div class="flex flex-col gap-2">
				<label for="bottle-time" class="text-sm font-medium text-ink">Heure</label>
				<input
					id="bottle-time"
					type="datetime-local"
					bind:value={time}
					class="border-border bg-surface-raised min-h-12 rounded-control border px-3 py-2 text-base"
				/>
			</div>
			<button
				type="button"
				disabled={pending || babyId === null}
				onclick={submit}
				class="bg-primary text-on-primary min-h-12 rounded-control px-4 py-2 font-semibold active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:active:scale-100"
			>
				{pending ? 'Enregistrement…' : 'Enregistrer'}
			</button>
		</div>
	</Sheet.Content>
</Sheet.Root>
