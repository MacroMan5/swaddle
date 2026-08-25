<script lang="ts">
	import { getContext } from 'svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Pause, Play } from '@lucide/svelte';
	import { startTimer, stopTimer, nursingAction, ApiError } from '$lib/client/api';
	import { formatClock, formatElapsed, nursingDurationMs } from '$lib/client/format';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import { isType } from '$lib/client/types';
	import type { EventDTO, NursingSegment, Side } from '$lib/client/types';

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

	const SIDES: { value: Side; label: string }[] = [
		{ value: 'left', label: 'Gauche' },
		{ value: 'right', label: 'Droite' }
	];

	let pending = $state(false);
	let error = $state<string | null>(null);

	// The whole sheet is a view over the single running nursing timer: no local
	// copy of the elapsed time, so a session started on another device shows the
	// same clocks here as soon as its SSE `sync` lands.
	const session = $derived(store.timers.find((t) => t.type === 'nursing') ?? null);
	const segments = $derived<NursingSegment[]>(
		session !== null && isType(session, 'nursing') ? session.details.segments : []
	);
	const runningSide = $derived(segments.find((s) => s.endedAt === null)?.side ?? null);
	/** Side the session would resume on; null before the first segment. */
	const lastSide = $derived(segments.length > 0 ? segments[segments.length - 1].side : null);
	const totalMs = $derived(nursingDurationMs(segments, store.nowMs));

	function sideMs(side: Side): number {
		return nursingDurationMs(
			segments.filter((s) => s.side === side),
			store.nowMs
		);
	}

	function sideLabel(side: Side): string {
		return side === 'left' ? 'Gauche' : 'Droite';
	}

	/** What a tap on this tile will do — drives both the visible line and the
	 * accessible name, so the affordance is never colour-only. */
	function actionLabel(side: Side): string {
		if (runningSide === side) return 'Pause';
		if (session === null) return 'Démarrer';
		return runningSide === null && lastSide === side ? 'Reprendre' : 'Allaiter';
	}

	const statusLabel = $derived.by(() => {
		if (session === null) return 'Choisissez un sein pour démarrer';
		if (runningSide !== null) return `${sideLabel(runningSide)} en cours`;
		return `En pause · ${lastSide === null ? '' : sideLabel(lastSide).toLowerCase()}`.trim();
	});

	/** Runs a mutation and merges its confirmed event immediately: the sheet
	 * stays correct even if the SSE `sync` for it is slow or never arrives. */
	async function run(action: () => Promise<EventDTO>): Promise<boolean> {
		if (babyId === null || pending) return false;
		pending = true;
		error = null;
		try {
			store.applyServerEvent(await action());
			return true;
		} catch (e) {
			error = e instanceof ApiError ? e.userMessage : 'Une erreur est survenue.';
			return false;
		} finally {
			pending = false;
		}
	}

	function tapSide(side: Side): Promise<boolean> {
		// A single gesture covers the four states: no session, this side running,
		// session paused, other side running.
		if (session === null)
			return run(async () => {
				// {created:false} adopts an already-running session started elsewhere.
				const result = await startTimer('nursing', { babyId: babyId as string, caregiverId, side });
				return result.event;
			});
		if (runningSide === side)
			return run(() => nursingAction({ babyId: babyId as string, action: 'pause' }));
		if (runningSide === null)
			return run(() => nursingAction({ babyId: babyId as string, action: 'resume', side }));
		// The explicit target keeps the tap idempotent when this view is stale:
		// if another device already switched to `side`, the server no-ops
		// instead of flipping the session back.
		return run(() => nursingAction({ babyId: babyId as string, action: 'switch-side', side }));
	}

	async function finish(): Promise<void> {
		if (await run(() => stopTimer('nursing', { babyId: babyId as string }))) open = false;
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="bottom" data-testid="nursing-sheet">
		<Sheet.Header class="border-border border-b-2">
			<p class="text-section text-ink-muted uppercase">Minuteur</p>
			<Sheet.Title>Allaitement</Sheet.Title>
		</Sheet.Header>
		<div class="flex flex-col gap-4 px-4 pb-4">
			<div class="flex flex-col items-center gap-1">
				<span
					class="text-timer text-ink tabular-nums"
					data-testid="nursing-total"
					aria-hidden="true"
				>
					{formatClock(totalMs)}
				</span>
				<p class="text-ink-muted text-base" role="status">
					Total {formatElapsed(totalMs)} · {statusLabel}
				</p>
			</div>

			<div class="grid grid-cols-2 gap-3">
				{#each SIDES as option (option.value)}
					{@const active = runningSide === option.value}
					<button
						type="button"
						disabled={pending || babyId === null}
						aria-pressed={active}
						aria-label={`${option.label} · ${formatElapsed(sideMs(option.value))} · ${actionLabel(option.value)}`}
						onclick={() => tapSide(option.value)}
						data-testid={`nursing-side-${option.value}`}
						class="flex min-h-32 flex-col items-center justify-center gap-1 rounded-card border-2 px-2 py-3 active:translate-y-0.5 motion-reduce:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 {active
							? 'border-primary bg-feed-100 text-feed-700'
							: 'border-border bg-surface-raised text-ink'}"
					>
						<span class="text-base font-semibold">{option.label}</span>
						<span class="text-3xl font-bold tabular-nums">{formatClock(sideMs(option.value))}</span>
						<span class="flex items-center gap-1 text-base font-medium">
							{#if active}
								<Pause size={16} aria-hidden="true" />
							{:else}
								<Play size={16} aria-hidden="true" />
							{/if}
							{actionLabel(option.value)}
						</span>
					</button>
				{/each}
			</div>

			{#if error}
				<p class="text-danger text-base" role="alert">{error}</p>
			{/if}

			<button
				type="button"
				disabled={pending || session === null}
				onclick={finish}
				class="bg-primary text-on-primary text-field active:bg-primary-pressed flex h-[58px] items-center justify-start rounded-control px-4 active:translate-y-px motion-reduce:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
			>
				Terminer la tétée
			</button>
		</div>
	</Sheet.Content>
</Sheet.Root>
