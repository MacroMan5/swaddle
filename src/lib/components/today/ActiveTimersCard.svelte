<script lang="ts">
	import { getContext } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import { Heart, Wind, Moon } from '@lucide/svelte';
	import { stopTimer, ApiError } from '$lib/client/api';
	import { formatClock, nursingDurationMs } from '$lib/client/format';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import type { EventDTO, NursingDetails } from '$lib/client/types';

	let {
		babyId,
		onOpenNursing
	}: { babyId: string | null; onOpenNursing: () => void } = $props();

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
		if (event.type === 'nursing')
			return nursingDurationMs((event.details as NursingDetails).segments, store.nowMs);
		return Math.max(0, store.nowMs - Date.parse(event.startedAt));
	}

	function isPaused(event: EventDTO): boolean {
		const segments = (event.details as NursingDetails).segments;
		return segments.length > 0 && segments[segments.length - 1].endedAt !== null;
	}

	function currentSide(event: EventDTO): 'left' | 'right' {
		const segments = (event.details as NursingDetails).segments;
		return segments[segments.length - 1].side;
	}

	/** Runs a mutation and merges its confirmed event immediately (item 6): the
	 * card stays correct even if the SSE `sync` for it is slow or never arrives. */
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
			pumpVolumeErrors = { ...pumpVolumeErrors, [event.id]: 'Le volume doit être entre 1 et 1000 ml.' };
			return Promise.resolve();
		}
		pumpVolumeErrors = { ...pumpVolumeErrors, [event.id]: '' };
		return run(event.id, () => stopTimer('pump', { babyId: babyId as string, volumeMl }));
	}
</script>

{#if store.timers.length > 0}
	<Card.Root data-testid="active-timers" class="bg-surface-raised border-primary/30 border">
		<Card.Content class="flex flex-col gap-4">
			<h2 class="text-ink font-semibold">En cours</h2>
			{#each store.timers as event (event.id)}
				<div class="border-border flex flex-col gap-2 border-b pb-3 last:border-0 last:pb-0">
					<div class="flex items-center gap-2">
						{#if event.type === 'nursing'}
							<Heart size={18} class="text-feed-700" aria-hidden="true" />
						{:else if event.type === 'pump'}
							<Wind size={18} class="text-feed-700" aria-hidden="true" />
						{:else}
							<Moon size={18} class="text-sleep-700" aria-hidden="true" />
						{/if}
						<span class="text-ink font-medium">{label(event.type)}</span>
						<span class="text-ink tabular-nums ml-auto">{formatClock(elapsedMs(event))}</span>
					</div>

					{#if event.type === 'nursing'}
						<p class="text-ink-muted text-base">
							{currentSide(event) === 'left' ? 'Gauche' : 'Droite'}
							{isPaused(event) ? ' · En pause' : ''}
						</p>
						<div class="flex flex-wrap gap-2">
							<button
								type="button"
								disabled={isPending(event.id)}
								onclick={onOpenNursing}
								class="border-border bg-surface min-h-12 flex-1 rounded-control border px-2 py-2 text-base font-medium active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:active:scale-100"
							>
								Changer de côté
							</button>
							<button
								type="button"
								disabled={isPending(event.id)}
								onclick={() => finishNursing(event)}
								class="bg-primary text-on-primary min-h-12 flex-1 rounded-control px-2 py-2 text-base font-semibold active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:active:scale-100"
							>
								Terminer
							</button>
						</div>
					{:else if event.type === 'pump'}
						<div class="flex items-center gap-2">
							<label for={`pump-volume-${event.id}`} class="text-ink-muted text-base"
								>Volume (ml)</label
							>
							<input
								id={`pump-volume-${event.id}`}
								inputmode="decimal"
								bind:value={pumpVolumes[event.id]}
								aria-invalid={!!pumpVolumeErrors[event.id]}
								aria-describedby={pumpVolumeErrors[event.id] ? `pump-volume-error-${event.id}` : undefined}
								class="border-border bg-surface min-h-12 w-24 rounded-control border px-2 py-1 tabular-nums {pumpVolumeErrors[
									event.id
								]
									? 'border-danger'
									: ''}"
							/>
							<button
								type="button"
								disabled={isPending(event.id) || !pumpVolumes[event.id]}
								onclick={() => finishPump(event)}
								class="bg-primary text-on-primary min-h-12 ml-auto rounded-control px-3 py-2 text-base font-semibold active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:active:scale-100"
							>
								Terminer
							</button>
						</div>
						{#if pumpVolumeErrors[event.id]}
							<p id={`pump-volume-error-${event.id}`} class="text-danger text-base" role="alert">
								{pumpVolumeErrors[event.id]}
							</p>
						{/if}
					{:else}
						<button
							type="button"
							disabled={isPending(event.id)}
							onclick={() => finishSleep(event)}
							class="bg-primary text-on-primary min-h-12 rounded-control px-3 py-2 text-base font-semibold active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:active:scale-100"
						>
							Réveillé
						</button>
					{/if}
				</div>
			{/each}
			{#if error}
				<p class="text-danger text-base" role="alert">{error}</p>
			{/if}
		</Card.Content>
	</Card.Root>
{/if}
