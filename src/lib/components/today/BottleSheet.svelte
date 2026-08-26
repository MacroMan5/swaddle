<script lang="ts">
	import { getContext } from 'svelte';
	import { page } from '$app/state';
	import * as Sheet from '$lib/components/ui/sheet';
	import { LoaderCircle } from '@lucide/svelte';
	import { ApiError } from '$lib/client/api';
	import { fieldMessage } from '$lib/errors';
	import {
		formatVolumeValue,
		parseVolumeEntry,
		parseVolumeValue,
		volumeBounds,
		volumePresets,
		volumeStep
	} from '$lib/client/volume';
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

	// The household's unit (#44): the field, its steps and its presets are read
	// and written in it; only `volumeMl` ever leaves this component.
	const unit = $derived(page.data.volumeUnit);
	const step = $derived(volumeStep(unit));
	const presets = $derived(volumePresets(unit));

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

	/** One-handed entry: nudge the volume by one step of the household's unit,
	 * clamped to the range that unit can express inside the server's 1–1000 ml
	 * (FR-017 — the server stays the backstop of record). */
	function bump(delta: number): void {
		const { min, max } = volumeBounds(unit);
		const current = parseVolumeValue(volume);
		const base = current ?? 0;
		volume = formatVolumeValue(Math.min(max, Math.max(min, base + delta)), unit);
	}

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
		// Judged in the unit it was typed in, then converted to canonical
		// millilitres exactly once (#44). An out-of-range entry never reaches the
		// server: in oz it could otherwise round into a legal millilitre count
		// (0,04 oz → 1 ml) and come back displayed as "0,0 oz".
		const entry = parseVolumeEntry(volume, unit);
		if (entry.status === 'out-of-range') {
			pending = false;
			volumeError = entry.message;
			return;
		}
		// A blank or unparseable field is left to the server, whose own "must be
		// a number" message already covers it.
		const volumeMl = entry.status === 'ok' ? entry.volumeMl : NaN;
		let event;
		try {
			event = await store.changes.create({
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
					if (issue.path.endsWith('volumeMl')) volumeError = fieldMessage(issue, unit);
					else if (issue.path.endsWith('startedAt')) timeError = fieldMessage(issue, unit);
					else formError = fieldMessage(issue, unit);
				}
			} else {
				formError = e instanceof ApiError ? e.userMessage : 'Une erreur est survenue.';
			}
			return;
		}
		pending = false;
		localStorage.setItem('swaddle.lastMilkType', milkType);
		open = false;
		const savedEvent = event;
		onSaved(savedEvent.id, 'Biberon enregistré', async () => {
			await store.changes.delete(savedEvent.id);
		});
	}
</script>

<!-- Function binding (controlled): see EventEditSheet — a plain `{open}` prop
     lets bits-ui close itself even when the dirty-guard refuses. -->
<Sheet.Root bind:open={() => open, handleOpenChange}>
	<Sheet.Content side="bottom">
		<Sheet.Header class="border-border border-b-2">
			<p class="text-section text-ink-muted uppercase">Enregistrer</p>
			<Sheet.Title>Biberon</Sheet.Title>
		</Sheet.Header>
		<div class="flex flex-col gap-4 px-4 pb-4">
			{#if formError}
				<p class="text-danger text-base" role="alert">{formError}</p>
			{/if}
			<div class="flex flex-col gap-2">
				<span id="milk-type-label" class="text-section text-ink-muted uppercase">Type de lait</span>
				<div
					class="border-border divide-border grid grid-cols-3 divide-x-2 border-2"
					role="group"
					aria-labelledby="milk-type-label"
				>
					{#each MILK_TYPES as option (option.value)}
						<button
							type="button"
							aria-pressed={milkType === option.value}
							onclick={() => (milkType = option.value)}
							class="flex h-[50px] items-center justify-start truncate px-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset {milkType ===
							option.value
								? 'bg-ink text-surface'
								: 'bg-surface-raised text-ink-muted'}"
						>
							{option.label}
						</button>
					{/each}
				</div>
			</div>
			<div class="flex flex-col gap-2">
				<label for="bottle-volume" class="text-section text-ink-muted uppercase"
					>Volume ({unit})</label
				>
				<div
					class="flex items-stretch border-2 {volumeError ? 'border-danger' : 'border-border'} bg-surface-raised"
				>
					<input
						id="bottle-volume"
						inputmode="decimal"
						bind:value={volume}
						aria-invalid={volumeError !== null}
						aria-describedby={volumeError !== null ? 'bottle-volume-error' : undefined}
						class="text-amount text-ink w-0 min-w-0 flex-1 bg-transparent px-3 py-2 tabular-nums focus-visible:outline-none"
					/>
					<button
						type="button"
						aria-label="Moins {formatVolumeValue(step, unit)} {unit}"
						onclick={() => bump(-step)}
						class="border-border text-ink w-14 shrink-0 border-l-2 text-2xl font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
					>
						−
					</button>
					<button
						type="button"
						aria-label="Plus {formatVolumeValue(step, unit)} {unit}"
						onclick={() => bump(step)}
						class="border-border text-ink w-14 shrink-0 border-l-2 text-2xl font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
					>
						+
					</button>
				</div>
				<div class="grid grid-cols-4 gap-2">
					{#each presets as preset (preset)}
						{@const label = formatVolumeValue(preset, unit)}
						<button
							type="button"
							onclick={() => (volume = label)}
							class="border-border text-value text-ink h-10 border tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
						>
							{label}
						</button>
					{/each}
				</div>
				{#if volumeError}
					<p id="bottle-volume-error" class="text-danger text-base" role="alert">{volumeError}</p>
				{/if}
			</div>
			<div class="flex flex-col gap-2">
				<label for="bottle-time" class="text-section text-ink-muted uppercase">Heure</label>
				<input
					id="bottle-time"
					type="datetime-local"
					bind:value={time}
					aria-invalid={timeError !== null}
					aria-describedby={timeError !== null ? 'bottle-time-error' : undefined}
					class="bg-surface-raised text-field text-ink h-13 rounded-control border-2 px-3 py-2 tabular-nums {timeError
						? 'border-danger'
						: 'border-border'}"
				/>
				{#if timeError}
					<p id="bottle-time-error" class="text-danger text-base" role="alert">{timeError}</p>
				{/if}
			</div>
			<button
				type="button"
				disabled={pending || babyId === null}
				onclick={submit}
				class="bg-primary text-on-primary text-field active:bg-primary-pressed flex h-[58px] items-center justify-start gap-2 rounded-control px-4 active:translate-y-px motion-reduce:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
			>
				{#if pending}
					<LoaderCircle size={18} class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
				{/if}
				{pending ? 'Enregistrement…' : 'Enregistrer'}
			</button>
		</div>
	</Sheet.Content>
</Sheet.Root>
