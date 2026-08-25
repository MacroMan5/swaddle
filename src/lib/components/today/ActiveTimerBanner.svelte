<script lang="ts">
	// Full-accent banner at the top of the screen while a timer runs — the
	// one-thumb cockpit. Mutations are transposed verbatim from the old
	// ActiveTimersCard: same run() helper, same optimistic merge, same pump
	// validation. The per-breast detail lives in NursingSheet ("Changer" opens
	// it); the banner only carries what a half-asleep parent needs.
	import { getContext } from 'svelte';
	import { nursingAction, stopTimer, ApiError } from '$lib/client/api';
	import { formatClock, formatTimeOfDay, nursingDurationMs } from '$lib/client/format';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import { detailsOf, isType } from '$lib/client/types';
	import type { CaregiverDTO, EventDTO, Side } from '$lib/client/types';

	let {
		babyId,
		caregivers,
		onOpenNursing
	}: {
		babyId: string | null;
		caregivers: CaregiverDTO[];
		onOpenNursing: () => void;
	} = $props();

	const store = getContext<SyncStore>('sync');

	let pending = $state<Record<string, boolean>>({});
	let error = $state<string | null>(null);
	let pumpVolumes = $state<Record<string, string>>({});
	let pumpVolumeErrors = $state<Record<string, string>>({});

	function isPending(id: string): boolean {
		return pending[id] === true;
	}

	function label(type: EventDTO['type']): string {
		return type === 'nursing' ? 'Allaitement' : type === 'pump' ? 'Tirage' : 'Sommeil';
	}

	function elapsedMs(event: EventDTO): number {
		if (isType(event, 'nursing'))
			return nursingDurationMs(event.details.segments, store.nowMs);
		return Math.max(0, store.nowMs - Date.parse(event.startedAt));
	}

	// Narrows instead of casting: these were reachable from any event type and
	// only the template kept them honest.
	function isPaused(event: EventDTO): boolean {
		if (!isType(event, 'nursing')) return false;
		const { segments } = event.details;
		return segments.length > 0 && segments[segments.length - 1].endedAt !== null;
	}

	// Only ever called on the nursing timer; `detailsOf` states that instead of
	// leaving a cast to fail on an undefined field further down.
	function currentSide(event: EventDTO): Side {
		const { segments } = detailsOf(event, 'nursing');
		return segments[segments.length - 1].side;
	}

	function statusLine(event: EventDTO): string {
		const parts = [event.type === 'nursing' && isPaused(event) ? 'En pause' : 'En cours'];
		parts.push(label(event.type));
		if (event.type === 'nursing')
			parts.push(currentSide(event) === 'left' ? 'Gauche' : 'Droite');
		return parts.join(' · ');
	}

	function caregiverName(id: string | null): string | null {
		if (id === null) return null;
		return caregivers.find((c) => c.id === id)?.name ?? null;
	}

	/** Runs a mutation and merges its confirmed event immediately (item 6): the
	 * banner stays correct even if the SSE `sync` for it is slow or never arrives. */
	async function run(id: string, action: () => Promise<EventDTO>): Promise<void> {
		if (babyId === null || isPending(id)) return;
		pending = { ...pending, [id]: true };
		error = null;
		try {
			const event = await action();
			store.applyServerEvent(event);
		} catch (e) {
			error = e instanceof ApiError ? e.message : 'Une erreur est survenue.';
		} finally {
			pending = { ...pending, [id]: false };
		}
	}

	function togglePause(event: EventDTO): Promise<void> {
		const paused = isPaused(event);
		return run(event.id, () =>
			nursingAction({
				babyId: babyId as string,
				action: paused ? 'resume' : 'pause',
				...(paused ? { side: currentSide(event) } : {})
			})
		);
	}

	function finishNursing(event: EventDTO): Promise<void> {
		return run(event.id, () => stopTimer('nursing', { babyId: babyId as string }));
	}

	function finishSleep(event: EventDTO): Promise<void> {
		return run(event.id, () => stopTimer('sleep', { babyId: babyId as string }));
	}

	/** Client-side 1–1000 ml check (FR-017) before hitting the API — the server
	 * stays the backstop of record (item 7). */
	function finishPump(event: EventDTO): Promise<void> {
		const raw = pumpVolumes[event.id] ?? '';
		const volumeMl = Number(raw);
		if (raw.trim() === '' || !Number.isFinite(volumeMl) || volumeMl < 1 || volumeMl > 1000) {
			pumpVolumeErrors = {
				...pumpVolumeErrors,
				[event.id]: 'Le volume doit être entre 1 et 1000 ml.'
			};
			return Promise.resolve();
		}
		pumpVolumeErrors = { ...pumpVolumeErrors, [event.id]: '' };
		return run(event.id, () => stopTimer('pump', { babyId: babyId as string, volumeMl }));
	}

	const outlineButton =
		'border-on-primary text-on-primary flex h-13 items-center justify-start rounded-control border-2 px-3 font-semibold active:translate-y-px motion-reduce:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-primary disabled:opacity-50';
	const solidButton =
		'bg-on-primary text-primary-text flex h-13 items-center justify-start rounded-control px-3 font-bold active:translate-y-px motion-reduce:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-primary disabled:opacity-50';
</script>

{#if store.timers.length > 0}
	<div
		data-testid="active-timers"
		class="bg-primary text-on-primary divide-on-primary/25 -mx-4 -mt-4 flex flex-col divide-y px-4 py-3"
	>
		{#each store.timers as event (event.id)}
			{@const name = caregiverName(event.caregiverId)}
			<div class="flex flex-col gap-2.5 py-2 first:pt-0 last:pb-0">
				<p class="flex items-center gap-2">
					<span
						class="bg-on-primary animate-pulse-dot motion-reduce:animate-none size-2.5 shrink-0"
						aria-hidden="true"
					></span>
					<span class="text-status uppercase">{statusLine(event)}</span>
				</p>

				<div class="flex items-end justify-between gap-4">
					<span class="text-timer tabular-nums">{formatClock(elapsedMs(event))}</span>
					<span class="text-tile-hint flex flex-col items-end text-right">
						<span class="tabular-nums">{formatTimeOfDay(Date.parse(event.startedAt))}</span>
						{#if name !== null}<span>{name}</span>{/if}
					</span>
				</div>

				{#if event.type === 'nursing'}
					<div class="grid grid-cols-3 gap-2">
						<button
							type="button"
							disabled={isPending(event.id)}
							onclick={() => togglePause(event)}
							class={outlineButton}
						>
							{isPaused(event) ? 'Reprendre' : 'Pause'}
						</button>
						<button
							type="button"
							disabled={isPending(event.id)}
							onclick={onOpenNursing}
							class={outlineButton}
						>
							Changer
						</button>
						<button
							type="button"
							disabled={isPending(event.id)}
							onclick={() => finishNursing(event)}
							class={solidButton}
						>
							Terminer
						</button>
					</div>
				{:else if event.type === 'pump'}
					<div class="flex items-center gap-2">
						<label for={`pump-volume-${event.id}`} class="text-tile-hint">Volume (ml)</label>
						<input
							id={`pump-volume-${event.id}`}
							inputmode="decimal"
							bind:value={pumpVolumes[event.id]}
							aria-invalid={!!pumpVolumeErrors[event.id]}
							aria-describedby={pumpVolumeErrors[event.id]
								? `pump-volume-error-${event.id}`
								: undefined}
							class="border-on-primary bg-surface-raised text-ink h-13 w-24 rounded-control border-2 px-2 py-1 tabular-nums {pumpVolumeErrors[
								event.id
							]
								? 'border-danger'
								: ''}"
						/>
						<button
							type="button"
							disabled={isPending(event.id) || !pumpVolumes[event.id]}
							onclick={() => finishPump(event)}
							class="{solidButton} ml-auto"
						>
							Terminer
						</button>
					</div>
					{#if pumpVolumeErrors[event.id]}
						<p id={`pump-volume-error-${event.id}`} class="text-on-primary text-base" role="alert">
							{pumpVolumeErrors[event.id]}
						</p>
					{/if}
				{:else}
					<button
						type="button"
						disabled={isPending(event.id)}
						onclick={() => finishSleep(event)}
						class={solidButton}
					>
						Réveillé
					</button>
				{/if}
			</div>
		{/each}
		{#if error}
			<p class="text-on-primary pt-2 text-base font-semibold" role="alert">{error}</p>
		{/if}
	</div>
{/if}
