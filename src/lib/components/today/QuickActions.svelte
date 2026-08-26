<script lang="ts">
	// The three hero tiles plus the sleep/pump row — the strongest block on the
	// page. Behaviors are transposed from the old FeedCard/DiaperCard/SleepCard:
	// same API calls, same optimistic merge, same undo wiring.
	import { getContext } from 'svelte';
	import { page } from '$app/state';
	import { Droplets, Heart, Milk, Moon, Wind } from '@lucide/svelte';
	import { ApiError } from '$lib/client/api';
	import { formatVolume } from '$lib/client/volume';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import type { EventDTO } from '$lib/client/types';
	import { lastBottleVolumeMl } from './todayDerivations';

	let {
		babyId,
		caregiverId,
		onSaved,
		onOpenNursing,
		onOpenBottle,
		onOpenPump
	}: {
		babyId: string | null;
		caregiverId: string | null;
		onSaved: (id: string, message: string, onUndo: () => Promise<void>) => void;
		onOpenNursing: () => void;
		onOpenBottle: () => void;
		onOpenPump: () => void;
	} = $props();

	const store = getContext<SyncStore>('sync');

	// Open by default: FR-001 requires Pipi/Caca/Les deux one touch from the
	// home screen — the tile only collapses/expands the row.
	let diaperPickerOpen = $state(true);
	let diaperPending = $state(false);
	let sleepPending = $state(false);
	let error = $state<string | null>(null);

	const nursingActive = $derived(store.timers.some((t) => t.type === 'nursing'));
	const pumpActive = $derived(store.timers.some((t) => t.type === 'pump'));
	const sleepActive = $derived(store.timers.some((t) => t.type === 'sleep'));
	const lastVolume = $derived(lastBottleVolumeMl(store.events));
	// The hint mirrors the household's unit (#44); the stored value stays in ml.
	const unit = $derived(page.data.volumeUnit);

	function scrollToBanner(): void {
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		document
			.querySelector('[data-testid="active-timers"]')
			?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
	}

	function handleNursingTap(): void {
		if (nursingActive) {
			scrollToBanner();
			return;
		}
		onOpenNursing();
	}

	function handlePumpTap(): void {
		if (pumpActive) {
			scrollToBanner();
			return;
		}
		onOpenPump();
	}

	async function recordDiaper(pee: boolean, poo: boolean): Promise<void> {
		if (babyId === null || diaperPending) return;
		diaperPending = true;
		error = null;
		let event: EventDTO;
		try {
			event = await store.changes.create({
				babyId,
				caregiverId,
				type: 'diaper',
				startedAt: new Date(store.nowMs).toISOString(),
				details: { pee, poo }
			});
		} catch (e) {
			error = e instanceof ApiError ? e.userMessage : 'Une erreur est survenue.';
			diaperPending = false;
			return;
		}
		diaperPending = false;
		onSaved(event.id, 'Couche enregistrée', async () => {
			await store.changes.delete(event.id);
		});
	}

	async function startSleep(): Promise<void> {
		if (babyId === null || sleepPending) return;
		if (sleepActive) {
			scrollToBanner();
			return;
		}
		sleepPending = true;
		error = null;
		try {
			await store.changes.startTimer('sleep', { babyId, caregiverId });
		} catch (e) {
			error = e instanceof ApiError ? e.userMessage : 'Une erreur est survenue.';
		} finally {
			sleepPending = false;
		}
	}

	const tileBase =
		'relative flex h-32 flex-col items-start justify-between overflow-hidden rounded-card border-2 border-border p-3 pt-4 text-left shadow-sm active:translate-y-0.5 active:shadow-none motion-reduce:active:translate-y-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50';
	const pickerBase =
		'min-h-12 rounded-control border-2 border-border bg-surface-raised px-2 py-2 font-semibold text-ink active:translate-y-px active:shadow-none motion-reduce:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50';
</script>

<section class="flex flex-col gap-2.5">
	<h2 class="text-section text-ink-muted uppercase">Saisie rapide</h2>

	<div class="grid grid-cols-3 gap-2.5">
		<button
			type="button"
			aria-label="Allaiter"
			disabled={babyId === null}
			onclick={handleNursingTap}
			class="{tileBase} bg-feed-100"
			class:is-running={nursingActive}
		>
			<span class="tile-bar bg-feed-700 absolute inset-x-0 top-0 h-1.5" aria-hidden="true"></span>
			<Heart size={26} class="text-feed-700" aria-hidden="true" />
			<span class="flex flex-col gap-0.5" aria-hidden="true">
				<span class="tile-label text-tile text-ink">Allaiter</span>
				<span class="text-tile-hint text-ink-muted">{nursingActive ? 'En cours' : 'G · D'}</span>
			</span>
		</button>

		<button
			type="button"
			aria-label="Biberon"
			disabled={babyId === null}
			onclick={onOpenBottle}
			class="{tileBase} bg-feed-100"
		>
			<span class="tile-bar bg-feed-700 absolute inset-x-0 top-0 h-1.5" aria-hidden="true"></span>
			<Milk size={26} class="text-feed-700" aria-hidden="true" />
			<span class="flex flex-col gap-0.5" aria-hidden="true">
				<span class="tile-label text-tile text-ink">Biberon</span>
				<span class="text-tile-hint text-ink-muted tabular-nums">
					{lastVolume === null ? unit : formatVolume(lastVolume, unit)}
				</span>
			</span>
		</button>

		<button
			type="button"
			aria-label="Couche"
			aria-expanded={diaperPickerOpen}
			disabled={babyId === null}
			onclick={() => (diaperPickerOpen = !diaperPickerOpen)}
			class="{tileBase} bg-diaper-100"
		>
			<span class="tile-bar bg-diaper-700 absolute inset-x-0 top-0 h-1.5" aria-hidden="true"></span>
			<Droplets size={26} class="text-diaper-700" aria-hidden="true" />
			<span class="flex flex-col gap-0.5" aria-hidden="true">
				<span class="tile-label text-tile text-ink">Couche</span>
				<span class="text-tile-hint text-ink-muted">Pipi · Caca</span>
			</span>
		</button>
	</div>

	{#if diaperPickerOpen}
		<div class="grid grid-cols-3 gap-2.5">
			<button
				type="button"
				disabled={diaperPending || babyId === null}
				onclick={() => recordDiaper(true, false)}
				class={pickerBase}
			>
				Pipi
			</button>
			<button
				type="button"
				disabled={diaperPending || babyId === null}
				onclick={() => recordDiaper(false, true)}
				class={pickerBase}
			>
				Caca
			</button>
			<button
				type="button"
				disabled={diaperPending || babyId === null}
				onclick={() => recordDiaper(true, true)}
				class={pickerBase}
			>
				Les deux
			</button>
		</div>
	{/if}

	<div class="grid grid-cols-3 gap-2.5">
		<button
			type="button"
			aria-label={sleepActive ? 'Sommeil en cours' : 'Commencer le sommeil'}
			disabled={sleepPending || babyId === null}
			onclick={startSleep}
			class="bg-primary text-on-primary active:bg-primary-pressed col-span-2 flex h-14 items-center justify-start gap-2 rounded-control px-4 active:translate-y-px motion-reduce:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
			class:is-running={sleepActive}
		>
			<Moon size={20} aria-hidden="true" />
			<span class="text-tile" aria-hidden="true">{sleepActive ? 'En cours' : 'Sommeil'}</span>
		</button>
		<button
			type="button"
			aria-label="Tirage"
			disabled={babyId === null}
			onclick={handlePumpTap}
			class="border-border bg-surface-raised text-ink flex h-14 items-center justify-center gap-2 rounded-control border-2 active:translate-y-px active:shadow-none motion-reduce:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
			class:is-running={pumpActive}
		>
			<Wind size={20} aria-hidden="true" />
			<span class="text-tile-hint" aria-hidden="true">{pumpActive ? 'En cours' : 'Tirage'}</span>
		</button>
	</div>

	{#if error}
		<p class="text-danger text-base" role="alert">{error}</p>
	{/if}
</section>
