<script lang="ts">
	// Manual after-the-fact entry (FR-006): pick a type, then the same per-type
	// form shape as EventEditSheet. Times are editable and default to now.
	import { getContext, untrack } from 'svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Baby, Droplets, LoaderCircle, Milk, Moon, Wind } from '@lucide/svelte';
	import { ApiError, createEvent } from '$lib/client/api';
	import { fromLocalInputValue, toLocalInputValue } from './eventForm';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import type {
		CaregiverDTO,
		Details,
		EventDTO,
		EventType,
		MilkType,
		NursingSegment,
		PumpSide
	} from '$lib/client/types';

	let {
		open = $bindable(false),
		babyId,
		defaultAt,
		caregivers,
		onSaved
	}: {
		open?: boolean;
		babyId: string | null;
		/** Local `datetime-local` default (e.g. noon of the day being viewed). */
		defaultAt: Date;
		caregivers: CaregiverDTO[];
		// The confirmed create response is passed back so the caller can merge it
		// directly into its own visible list (slice-3 pattern).
		onSaved: (event: EventDTO) => void;
	} = $props();

	const store = getContext<SyncStore>('sync');

	const TYPES: { value: EventType; label: string; icon: typeof Milk }[] = [
		{ value: 'nursing', label: 'Allaitement', icon: Baby },
		{ value: 'bottle', label: 'Biberon', icon: Milk },
		{ value: 'pump', label: 'Tirage', icon: Wind },
		{ value: 'diaper', label: 'Couche', icon: Droplets },
		{ value: 'sleep', label: 'Sommeil', icon: Moon }
	];
	const MILK_TYPES: { value: MilkType; label: string }[] = [
		{ value: 'breast', label: 'Maternel' },
		{ value: 'formula', label: 'Préparation' },
		{ value: 'mixed', label: 'Mixte' }
	];
	const PUMP_SIDES: { value: PumpSide; label: string }[] = [
		{ value: 'left', label: 'Gauche' },
		{ value: 'right', label: 'Droite' },
		{ value: 'both', label: 'Les deux' }
	];

	let selectedType = $state<EventType | null>(null);
	let caregiverId = $state<string>('');
	let note = $state('');
	let startedAt = $state('');
	let endedAt = $state('');
	let milkType = $state<MilkType>('breast');
	let volumeMl = $state('');
	let pumpSide = $state<PumpSide>('both');
	let pee = $state(false);
	let poo = $state(false);
	let leftMinutes = $state('');
	let rightMinutes = $state('');

	let pending = $state(false);
	let formError = $state<string | null>(null);
	let startedAtError = $state<string | null>(null);
	let volumeError = $state<string | null>(null);

	const isDirty = $derived(selectedType !== null);

	// Resets the form only on the closed→open transition. `defaultAt` is read
	// via untrack(): the parent recreates it from the ticking store.nowMs, so a
	// tracked read here would rerun this effect (and wipe every field, mid
	// entry) once a second for as long as the sheet stayed open (review P1).
	// `open` is the only tracked dependency, so this only reruns when the sheet
	// itself opens or closes.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			selectedType = null;
			caregiverId = '';
			note = '';
			startedAt = toLocalInputValue(defaultAt);
			endedAt = toLocalInputValue(defaultAt);
			milkType = 'breast';
			volumeMl = '';
			pumpSide = 'both';
			pee = false;
			poo = false;
			leftMinutes = '';
			rightMinutes = '';
			formError = null;
			startedAtError = null;
			volumeError = null;
		});
	});

	function handleOpenChange(next: boolean): void {
		if (!next && isDirty) {
			const confirmed = typeof confirm === 'undefined' || confirm('Fermer sans enregistrer ?');
			if (!confirmed) return;
		}
		open = next;
	}

	function buildNursingSegments(): NursingSegment[] {
		const start = fromLocalInputValue(startedAt);
		const segments: NursingSegment[] = [];
		let cursorMs = Date.parse(start);
		const left = Number(leftMinutes) || 0;
		const right = Number(rightMinutes) || 0;
		if (left > 0) {
			const segEnd = cursorMs + left * 60_000;
			segments.push({ side: 'left', startedAt: new Date(cursorMs).toISOString(), endedAt: new Date(segEnd).toISOString() });
			cursorMs = segEnd;
		}
		if (right > 0) {
			const segEnd = cursorMs + right * 60_000;
			segments.push({ side: 'right', startedAt: new Date(cursorMs).toISOString(), endedAt: new Date(segEnd).toISOString() });
			cursorMs = segEnd;
		}
		return segments;
	}

	async function submit(): Promise<void> {
		if (babyId === null || selectedType === null || pending) return;
		pending = true;
		formError = null;
		startedAtError = null;
		volumeError = null;

		try {
			const start = fromLocalInputValue(startedAt);
			let end: string | null = null;
			let details: Details;

			if (selectedType === 'nursing') {
				const segments = buildNursingSegments();
				if (segments.length === 0) {
					volumeError = 'Indiquez au moins une durée (gauche ou droite).';
					pending = false;
					return;
				}
				details = { segments };
				end = segments[segments.length - 1].endedAt;
			} else if (selectedType === 'bottle') {
				details = { milkType, volumeMl: Number(volumeMl) };
			} else if (selectedType === 'pump') {
				details = { side: pumpSide, volumeMl: Number(volumeMl) };
				end = fromLocalInputValue(endedAt);
			} else if (selectedType === 'diaper') {
				details = { pee, poo };
			} else {
				details = {};
				end = fromLocalInputValue(endedAt);
			}

			const created = await createEvent({
				babyId,
				caregiverId: caregiverId === '' ? null : caregiverId,
				type: selectedType,
				startedAt: selectedType === 'nursing' ? buildNursingSegments()[0]?.startedAt ?? start : start,
				endedAt: end,
				note: note.trim() === '' ? null : note,
				details
			});
			store.applyServerEvent(created);
			open = false;
			onSaved(created);
		} catch (e) {
			if (e instanceof ApiError && e.issues.length > 0) {
				for (const issue of e.issues) {
					if (issue.path.endsWith('startedAt')) startedAtError = issue.message;
					else if (issue.path.endsWith('volumeMl')) volumeError = issue.message;
					else formError = issue.message;
				}
			} else {
				formError = e instanceof ApiError ? e.message : 'Une erreur est survenue.';
			}
		} finally {
			pending = false;
		}
	}
</script>

<!-- Function binding (controlled): see EventEditSheet — a plain `{open}` prop
     lets bits-ui close itself even when the dirty-guard refuses. -->
<Sheet.Root bind:open={() => open, handleOpenChange}>
	<Sheet.Content side="bottom">
		<Sheet.Header class="border-border border-b-2">
			<Sheet.Title>Ajouter une entrée</Sheet.Title>
		</Sheet.Header>
		<div class="flex flex-col gap-4 px-4 pb-4">
			{#if formError}
				<p class="text-danger text-base" role="alert">{formError}</p>
			{/if}

			{#if selectedType === null}
				<div class="grid grid-cols-2 gap-2">
					{#each TYPES as t (t.value)}
						<button
							type="button"
							onclick={() => (selectedType = t.value)}
							class="border-border bg-surface-raised text-ink flex min-h-12 items-center justify-center gap-2 rounded-control border-2 px-2 py-2 font-medium active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:translate-y-0"
						>
							<t.icon size={18} aria-hidden="true" />
							{t.label}
						</button>
					{/each}
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					<label for="add-started-at" class="text-ink text-base font-medium">Début</label>
					<input
						id="add-started-at"
						type="datetime-local"
						bind:value={startedAt}
						aria-invalid={startedAtError !== null}
						class="border-border bg-surface-raised min-h-12 rounded-control border-2 px-3 py-2 text-base {startedAtError
							? 'border-danger'
							: ''}"
					/>
					{#if startedAtError}<p class="text-danger text-base" role="alert">{startedAtError}</p>{/if}
				</div>

				{#if selectedType === 'sleep' || selectedType === 'pump'}
					<div class="flex flex-col gap-2">
						<label for="add-ended-at" class="text-ink text-base font-medium">Fin</label>
						<input
							id="add-ended-at"
							type="datetime-local"
							bind:value={endedAt}
							class="border-border bg-surface-raised min-h-12 rounded-control border-2 px-3 py-2 text-base"
						/>
					</div>
				{/if}

				{#if selectedType === 'bottle'}
					<div class="flex flex-col gap-2">
						<span class="text-ink text-base font-medium">Type de lait</span>
						<div class="grid grid-cols-3 gap-2">
							{#each MILK_TYPES as option (option.value)}
								<button
									type="button"
									aria-pressed={milkType === option.value}
									onclick={() => (milkType = option.value)}
									class="min-h-12 rounded-control border-2 px-2 py-2 font-medium active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:translate-y-0 {milkType ===
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
						<label for="add-volume" class="text-ink text-base font-medium">Volume (ml)</label>
						<input
							id="add-volume"
							inputmode="decimal"
							bind:value={volumeMl}
							aria-invalid={volumeError !== null}
							class="border-border bg-surface-raised min-h-12 rounded-control border-2 px-3 py-2 text-base tabular-nums {volumeError
								? 'border-danger'
								: ''}"
						/>
						{#if volumeError}<p class="text-danger text-base" role="alert">{volumeError}</p>{/if}
					</div>
				{/if}

				{#if selectedType === 'pump'}
					<div class="flex flex-col gap-2">
						<span class="text-ink text-base font-medium">Côté</span>
						<div class="grid grid-cols-3 gap-2">
							{#each PUMP_SIDES as option (option.value)}
								<button
									type="button"
									aria-pressed={pumpSide === option.value}
									onclick={() => (pumpSide = option.value)}
									class="min-h-12 rounded-control border-2 px-2 py-2 font-medium active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:translate-y-0 {pumpSide ===
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
						<label for="add-pump-volume" class="text-ink text-base font-medium">Volume (ml)</label>
						<input
							id="add-pump-volume"
							inputmode="decimal"
							bind:value={volumeMl}
							aria-invalid={volumeError !== null}
							class="border-border bg-surface-raised min-h-12 rounded-control border-2 px-3 py-2 text-base tabular-nums {volumeError
								? 'border-danger'
								: ''}"
						/>
						{#if volumeError}<p class="text-danger text-base" role="alert">{volumeError}</p>{/if}
					</div>
				{/if}

				{#if selectedType === 'diaper'}
					<div class="flex flex-col gap-2">
						<span class="text-ink text-base font-medium">Contenu</span>
						<div class="grid grid-cols-2 gap-2">
							<button
								type="button"
								aria-pressed={pee}
								onclick={() => (pee = !pee)}
								class="min-h-12 rounded-control border-2 px-2 py-2 font-medium active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:translate-y-0 {pee
									? 'border-diaper-500 bg-diaper-100 text-diaper-700'
									: 'border-border bg-surface-raised text-ink-muted'}"
							>
								Pipi
							</button>
							<button
								type="button"
								aria-pressed={poo}
								onclick={() => (poo = !poo)}
								class="min-h-12 rounded-control border-2 px-2 py-2 font-medium active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:translate-y-0 {poo
									? 'border-diaper-500 bg-diaper-100 text-diaper-700'
									: 'border-border bg-surface-raised text-ink-muted'}"
							>
								Caca
							</button>
						</div>
					</div>
				{/if}

				{#if selectedType === 'nursing'}
					<div class="grid grid-cols-2 gap-2">
						<div class="flex flex-col gap-2">
							<label for="add-left-min" class="text-ink text-base font-medium">Minutes gauche</label>
							<input
								id="add-left-min"
								inputmode="numeric"
								bind:value={leftMinutes}
								class="border-border bg-surface-raised min-h-12 rounded-control border-2 px-3 py-2 text-base tabular-nums"
							/>
						</div>
						<div class="flex flex-col gap-2">
							<label for="add-right-min" class="text-ink text-base font-medium">Minutes droite</label>
							<input
								id="add-right-min"
								inputmode="numeric"
								bind:value={rightMinutes}
								class="border-border bg-surface-raised min-h-12 rounded-control border-2 px-3 py-2 text-base tabular-nums"
							/>
						</div>
					</div>
					{#if volumeError}<p class="text-danger text-base" role="alert">{volumeError}</p>{/if}
				{/if}

				<div class="flex flex-col gap-2">
					<label for="add-caregiver" class="text-ink text-base font-medium">Aidant</label>
					<select
						id="add-caregiver"
						bind:value={caregiverId}
						class="border-border bg-surface-raised min-h-12 rounded-control border-2 px-3 py-2 text-base"
					>
						<option value="">Aucun</option>
						{#each caregivers as cg (cg.id)}
							<option value={cg.id}>{cg.name}</option>
						{/each}
					</select>
				</div>

				<div class="flex flex-col gap-2">
					<label for="add-note" class="text-ink text-base font-medium">Note</label>
					<input
						id="add-note"
						bind:value={note}
						class="border-border bg-surface-raised min-h-12 rounded-control border-2 px-3 py-2 text-base"
					/>
				</div>

				<button
					type="button"
					disabled={pending || babyId === null}
					onclick={submit}
					class="bg-primary text-on-primary flex min-h-12 items-center justify-center gap-2 rounded-control px-4 py-2 font-semibold active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:active:translate-y-0"
				>
					{#if pending}
						<LoaderCircle size={18} class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
					{/if}
					{pending ? 'Enregistrement…' : 'Enregistrer'}
				</button>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>
