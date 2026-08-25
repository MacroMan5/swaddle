<script lang="ts">
	// Edit/delete an existing event (FR-007, § Formulaires). Fields vary by type;
	// nursing exposes its segments instead of a single end time. Delete opens the
	// caller's 5 s undo toast; every confirmed response merges into local state.
	import { getContext, untrack } from 'svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import { LoaderCircle } from '@lucide/svelte';
	import { ApiError, deleteEvent, patchEvent, restoreEvent } from '$lib/client/api';
	import { fromLocalInputValue, toLocalInputValue } from './eventForm';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import { isType } from '$lib/client/types';
	import type {
		CaregiverDTO,
		Details,
		EventDTO,
		MilkType,
		NursingSegment,
		PumpSide,
		Side
	} from '$lib/client/types';

	let {
		open = $bindable(false),
		event,
		caregivers,
		onSaved,
		onDeleted
	}: {
		open?: boolean;
		event: EventDTO | null;
		caregivers: CaregiverDTO[];
		// Confirmed HTTP responses are passed back so the caller can merge them
		// directly into its own visible list (slice-3 pattern) — the caller must
		// not rely solely on a background refetch/relay to reflect its own writes.
		onSaved: (event: EventDTO) => void;
		onDeleted: (event: EventDTO, message: string, onUndo: () => Promise<EventDTO>) => void;
	} = $props();

	const store = getContext<SyncStore>('sync');

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

	let caregiverId = $state<string>('');
	let note = $state('');
	let startedAt = $state('');
	let endedAt = $state('');
	let milkType = $state<MilkType>('breast');
	let volumeMl = $state('');
	let pumpSide = $state<PumpSide>('both');
	let pee = $state(false);
	let poo = $state(false);
	let segments = $state<{ side: Side; startedAt: string; endedAt: string; error: string | null }[]>(
		[]
	);

	let pending = $state(false);
	let deleting = $state(false);
	let formError = $state<string | null>(null);
	let startedAtError = $state<string | null>(null);
	let endedAtError = $state<string | null>(null);
	let volumeError = $state<string | null>(null);

	// Snapshot of the form as initialized from the event; the close-confirm only
	// fires when the current form actually differs from it.
	let initialForm = $state('');

	function serializeForm(): string {
		return JSON.stringify({
			caregiverId,
			note,
			startedAt,
			endedAt,
			milkType,
			volumeMl,
			pumpSide,
			pee,
			poo,
			segments: segments.map((s) => ({ side: s.side, startedAt: s.startedAt, endedAt: s.endedAt }))
		});
	}

	const isDirty = $derived(open && event !== null && serializeForm() !== initialForm);

	$effect(() => {
		if (!open || event === null) return;
		caregiverId = event.caregiverId ?? '';
		note = event.note ?? '';
		startedAt = toLocalInputValue(new Date(Date.parse(event.startedAt)));
		endedAt = event.endedAt === null ? '' : toLocalInputValue(new Date(Date.parse(event.endedAt)));
		formError = null;
		startedAtError = null;
		endedAtError = null;
		volumeError = null;

		if (isType(event, 'bottle')) {
			const d = event.details;
			milkType = d.milkType;
			volumeMl = String(d.volumeMl);
		} else if (isType(event, 'pump')) {
			const d = event.details;
			pumpSide = d.side;
			volumeMl = d.volumeMl === null ? '' : String(d.volumeMl);
		} else if (isType(event, 'diaper')) {
			const d = event.details;
			pee = d.pee;
			poo = d.poo;
		} else if (isType(event, 'nursing')) {
			const d = event.details;
			segments = d.segments.map((s) => ({
				side: s.side,
				startedAt: toLocalInputValue(new Date(Date.parse(s.startedAt))),
				endedAt: s.endedAt === null ? '' : toLocalInputValue(new Date(Date.parse(s.endedAt))),
				error: null
			}));
		}
		// untrack: reading the form fields here must not make them effect deps,
		// or every user edit would re-run the effect and reset the form.
		initialForm = untrack(() => serializeForm());
	});

	function setSegmentSide(index: number, side: Side): void {
		segments = segments.map((s, i) => (i === index ? { ...s, side } : s));
	}

	function handleOpenChange(next: boolean): void {
		if (!next && isDirty) {
			const confirmed =
				typeof confirm === 'undefined' || confirm('Fermer sans enregistrer les modifications ?');
			if (!confirmed) return;
		}
		open = next;
	}

	function applyIssues(issues: { path: string; message: string }[]): void {
		for (const issue of issues) {
			// details.segments.<i>[...] — route to that segment row (review item 7),
			// e.g. an overlap, out-of-order, or out-of-bounds segment.
			const segmentMatch = issue.path.match(/^details\.segments\.(\d+)/);
			if (segmentMatch) {
				const index = Number(segmentMatch[1]);
				segments = segments.map((s, i) => (i === index ? { ...s, error: issue.message } : s));
				continue;
			}
			if (issue.path === 'details.segments') {
				formError = issue.message;
				continue;
			}
			if (issue.path.endsWith('startedAt')) startedAtError = issue.message;
			else if (issue.path.endsWith('endedAt')) endedAtError = issue.message;
			else if (issue.path.endsWith('volumeMl')) volumeError = issue.message;
			else formError = issue.message;
		}
	}

	async function submit(): Promise<void> {
		if (event === null || pending) return;
		pending = true;
		formError = null;
		startedAtError = null;
		endedAtError = null;
		volumeError = null;
		segments = segments.map((s) => ({ ...s, error: null }));

		try {
			let updated: EventDTO;
			if (event.type === 'nursing') {
				const built: NursingSegment[] = segments.map((s) => ({
					side: s.side,
					startedAt: fromLocalInputValue(s.startedAt),
					endedAt: s.endedAt === '' ? null : fromLocalInputValue(s.endedAt)
				}));
				const last = built[built.length - 1];
				updated = await patchEvent(event.id, {
					caregiverId: caregiverId === '' ? null : caregiverId,
					note: note.trim() === '' ? null : note,
					startedAt: built[0]?.startedAt,
					endedAt: last?.endedAt ?? undefined,
					details: { segments: built }
				});
			} else {
				const details: Details =
					event.type === 'bottle'
						? { milkType, volumeMl: Number(volumeMl) }
						: event.type === 'pump'
							? { side: pumpSide, volumeMl: volumeMl === '' ? null : Number(volumeMl) }
							: event.type === 'diaper'
								? { pee, poo }
								: {};
				updated = await patchEvent(event.id, {
					caregiverId: caregiverId === '' ? null : caregiverId,
					note: note.trim() === '' ? null : note,
					startedAt: fromLocalInputValue(startedAt),
					endedAt: endedAt === '' ? undefined : fromLocalInputValue(endedAt),
					details
				});
			}
			store.applyServerEvent(updated);
			open = false;
			onSaved(updated);
		} catch (e) {
			if (e instanceof ApiError && e.issues.length > 0) applyIssues(e.issues);
			else formError = e instanceof ApiError ? e.userMessage : 'Une erreur est survenue.';
		} finally {
			pending = false;
		}
	}

	async function remove(): Promise<void> {
		if (event === null || deleting) return;
		deleting = true;
		formError = null;
		try {
			const deletedEvent = await deleteEvent(event.id);
			store.applyServerEvent(deletedEvent, true);
			const id = event.id;
			open = false;
			onDeleted(deletedEvent, 'Entrée supprimée', async () => {
				try {
					const restored = await restoreEvent(id);
					store.applyServerEvent(restored);
					return restored;
				} catch (e) {
					throw e instanceof ApiError && e.code === 'timer_conflict'
						? new Error('Un minuteur du même type est déjà en cours.')
						: e;
				}
			});
		} catch (e) {
			formError = e instanceof ApiError ? e.userMessage : 'Impossible de supprimer.';
		} finally {
			deleting = false;
		}
	}
</script>

<!-- Function binding (controlled): with a plain `{open}` prop, bits-ui closes
     itself internally when the guard refuses, leaving the sheet closed but the
     parent's `open` true — the confirm is bypassed and the sheet can't reopen. -->
<Sheet.Root bind:open={() => open, handleOpenChange}>
	<Sheet.Content side="bottom">
		<Sheet.Header class="border-border border-b-2">
			<Sheet.Title>Modifier l’entrée</Sheet.Title>
		</Sheet.Header>
		{#if event}
			<div class="flex flex-col gap-4 px-4 pb-4">
				{#if formError}
					<p class="text-danger text-base" role="alert">{formError}</p>
				{/if}

				{#if event.type !== 'nursing'}
					<div class="flex flex-col gap-2">
						<label for="edit-started-at" class="text-ink text-base font-medium">Début</label>
						<input
							id="edit-started-at"
							type="datetime-local"
							bind:value={startedAt}
							aria-invalid={startedAtError !== null}
							class="border-border bg-surface-raised min-h-12 rounded-control border-2 px-3 py-2 text-base {startedAtError
								? 'border-danger'
								: ''}"
						/>
						{#if startedAtError}<p class="text-danger text-base" role="alert">{startedAtError}</p>{/if}
					</div>
				{/if}

				{#if event.type === 'sleep' || event.type === 'pump'}
					<div class="flex flex-col gap-2">
						<label for="edit-ended-at" class="text-ink text-base font-medium">Fin</label>
						<input
							id="edit-ended-at"
							type="datetime-local"
							bind:value={endedAt}
							aria-invalid={endedAtError !== null}
							class="border-border bg-surface-raised min-h-12 rounded-control border-2 px-3 py-2 text-base {endedAtError
								? 'border-danger'
								: ''}"
						/>
						{#if endedAtError}<p class="text-danger text-base" role="alert">{endedAtError}</p>{/if}
					</div>
				{/if}

				{#if event.type === 'bottle'}
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
						<label for="edit-volume" class="text-ink text-base font-medium">Volume (ml)</label>
						<input
							id="edit-volume"
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

				{#if event.type === 'pump'}
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
						<label for="edit-pump-volume" class="text-ink text-base font-medium">Volume (ml)</label>
						<input
							id="edit-pump-volume"
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

				{#if event.type === 'diaper'}
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

				{#if event.type === 'nursing'}
					<div class="flex flex-col gap-2">
						<span class="text-ink text-base font-medium">Segments</span>
						{#each segments as segment, i (i)}
							<div class="border-border bg-surface-raised flex flex-col gap-2 rounded-control border p-2">
								<div class="grid grid-cols-2 gap-2" role="group" aria-label={`Côté du segment ${i + 1}`}>
									<button
										type="button"
										aria-pressed={segment.side === 'left'}
										onclick={() => setSegmentSide(i, 'left')}
										class="min-h-12 rounded-control border-2 px-2 py-1 font-medium active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:translate-y-0 {segment.side ===
										'left'
											? 'border-feed-500 bg-feed-100 text-feed-700'
											: 'border-border bg-surface text-ink-muted'}"
									>
										Gauche
									</button>
									<button
										type="button"
										aria-pressed={segment.side === 'right'}
										onclick={() => setSegmentSide(i, 'right')}
										class="min-h-12 rounded-control border-2 px-2 py-1 font-medium active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:translate-y-0 {segment.side ===
										'right'
											? 'border-feed-500 bg-feed-100 text-feed-700'
											: 'border-border bg-surface text-ink-muted'}"
									>
										Droite
									</button>
								</div>
								<div class="flex flex-col gap-2 sm:flex-row">
									<input
										type="datetime-local"
										aria-label={`Début du segment ${i + 1}`}
										aria-invalid={segment.error !== null}
										bind:value={segment.startedAt}
										class="border-border bg-surface min-h-12 flex-1 rounded-control border-2 px-2 py-1 text-base {segment.error
											? 'border-danger'
											: ''}"
									/>
									<input
										type="datetime-local"
										aria-label={`Fin du segment ${i + 1}`}
										aria-invalid={segment.error !== null}
										bind:value={segment.endedAt}
										class="border-border bg-surface min-h-12 flex-1 rounded-control border-2 px-2 py-1 text-base {segment.error
											? 'border-danger'
											: ''}"
									/>
								</div>
								{#if segment.error}<p class="text-danger text-base" role="alert">{segment.error}</p>{/if}
							</div>
						{/each}
						{#if startedAtError}<p class="text-danger text-base" role="alert">{startedAtError}</p>{/if}
						{#if endedAtError}<p class="text-danger text-base" role="alert">{endedAtError}</p>{/if}
					</div>
				{/if}

				<div class="flex flex-col gap-2">
					<label for="edit-caregiver" class="text-ink text-base font-medium">Aidant</label>
					<select
						id="edit-caregiver"
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
					<label for="edit-note" class="text-ink text-base font-medium">Note</label>
					<input
						id="edit-note"
						bind:value={note}
						class="border-border bg-surface-raised min-h-12 rounded-control border-2 px-3 py-2 text-base"
					/>
				</div>

				<button
					type="button"
					disabled={pending}
					onclick={submit}
					class="bg-primary text-on-primary flex min-h-12 items-center justify-center gap-2 rounded-control px-4 py-2 font-semibold active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:active:translate-y-0"
				>
					{#if pending}
						<LoaderCircle size={18} class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
					{/if}
					{pending ? 'Enregistrement…' : 'Enregistrer'}
				</button>

				<button
					type="button"
					disabled={deleting}
					onclick={remove}
					class="border-danger text-danger flex min-h-12 items-center justify-center gap-2 rounded-control border-2 px-4 py-2 font-semibold active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50 motion-reduce:active:translate-y-0"
				>
					{deleting ? 'Suppression…' : 'Supprimer'}
				</button>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
