<script lang="ts">
	// Untimed recovery path (issue #50): the five-second undo toast on a delete
	// (EventEditSheet) is a convenience, not the only way back. This sheet lists
	// every soft-deleted event for the baby (GET /api/events?deleted=1) and
	// restores through the same authoritative POST /api/events/[id]/restore
	// endpoint the toast uses, so both paths share one source of truth and the
	// same active-timer conflict handling (FR-013).
	import { getContext, onDestroy, onMount } from 'svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import { LoaderCircle, RotateCcw } from '@lucide/svelte';
	import { ApiError, listDeletedEvents } from '$lib/client/api';
	import { upsert } from '$lib/client/eventList';
	import { formatTimeOfDay } from '$lib/client/format';
	import { eventLabel, typeLabel } from './eventDisplay';
	import type { ConfirmedActivityChange } from '$lib/client/activityChanges';
	import type { SyncStore } from '$lib/client/sync.svelte';
	import type { EventDTO } from '$lib/client/types';

	let {
		open = $bindable(false),
		babyId
	}: {
		open?: boolean;
		babyId: string | null;
	} = $props();

	const store = getContext<SyncStore>('sync');

	let events = $state<EventDTO[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let restoringId = $state<string | null>(null);
	let rowErrors = $state<Record<string, string>>({});

	// Anti-race token (same pattern as historyWindow.svelte.ts's fetch tokens):
	// the open effect, the change-relay subscription and a re-open can all
	// trigger overlapping loads. Only the response matching the latest call is
	// ever committed, so a slower, earlier-issued fetch can't land after a
	// newer one and either drop a just-deleted event or resurrect one already
	// restored (P2 review item 1).
	let loadToken = 0;
	let activeLoadToken: number | null = null;
	let loadBuffer: ConfirmedActivityChange[] = [];

	function sortByDeletedAtDesc(list: EventDTO[]): EventDTO[] {
		return [...list].sort(
			(a, b) =>
				Date.parse(b.deletedAt ?? b.updatedAt) - Date.parse(a.deletedAt ?? a.updatedAt)
		);
	}

	function applyChange(list: EventDTO[], change: ConfirmedActivityChange): EventDTO[] {
		const keep = change.kind === 'deleted' || change.event.deletedAt !== null;
		return upsert(list, change.event, keep, sortByDeletedAtDesc);
	}

	function deletedAtLabel(event: EventDTO): string {
		const ms = Date.parse(event.deletedAt ?? event.updatedAt);
		const date = new Date(ms);
		const day = String(date.getDate()).padStart(2, '0');
		const month = String(date.getMonth() + 1).padStart(2, '0');
		return `Supprimé le ${day}/${month} à ${formatTimeOfDay(ms)}`;
	}

	async function load(): Promise<void> {
		if (babyId === null) return;
		const token = ++loadToken;
		activeLoadToken = token;
		loadBuffer = [];
		loading = true;
		error = null;
		try {
			const fetched = await listDeletedEvents(babyId);
			if (token !== loadToken) return; // superseded by a newer load
			let merged = sortByDeletedAtDesc(fetched);
			for (const change of loadBuffer) merged = applyChange(merged, change);
			events = merged;
		} catch (e) {
			if (token !== loadToken) return;
			error =
				e instanceof ApiError ? e.userMessage : 'Impossible de charger les éléments supprimés.';
		} finally {
			if (token === loadToken) {
				activeLoadToken = null;
				loadBuffer = [];
				loading = false;
			}
		}
	}

	$effect(() => {
		if (open) void load();
	});

	// Kept live while the sheet is open: another device restoring or deleting an
	// event, or a full data restore (reset), must not leave this list stale.
	let unsubscribe: (() => void) | null = null;
	onMount(() => {
		unsubscribe = store.subscribeChanges((change) => {
			if (!open) return;
			if (change.kind === 'reset') {
				void load();
				return;
			}
			if (babyId !== null && change.event.babyId !== babyId) return;
			events = applyChange(events, change);
			if (activeLoadToken === loadToken) loadBuffer.push(change);
		});
	});
	onDestroy(() => unsubscribe?.());

	async function restore(event: EventDTO): Promise<void> {
		if (restoringId !== null) return;
		restoringId = event.id;
		rowErrors = { ...rowErrors, [event.id]: '' };
		try {
			await store.changes.restore(event.id);
		} catch (e) {
			const message = e instanceof ApiError ? e.userMessage : 'Impossible de restaurer.';
			rowErrors = { ...rowErrors, [event.id]: message };
		} finally {
			restoringId = null;
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="bottom">
		<Sheet.Header class="border-border border-b-2">
			<Sheet.Title>Supprimés récemment</Sheet.Title>
		</Sheet.Header>
		<div class="flex flex-col gap-2 px-4 pb-4">
			{#if error}
				<p class="text-danger text-base" role="alert">{error}</p>
			{/if}
			{#if loading}
				<p class="text-ink-muted p-4 text-center text-base">Chargement…</p>
			{:else if events.length === 0}
				<p class="text-ink-muted p-4 text-center text-base">Aucun élément supprimé récemment.</p>
			{:else}
				<ul class="divide-border-hair bg-surface-raised flex max-h-[60vh] flex-col divide-y overflow-y-auto">
					{#each events as event (event.id)}
						<li data-testid="recently-deleted-row" class="flex items-center justify-between gap-2 px-2 py-2">
							<div class="min-w-0 flex-1">
								<span class="text-row text-ink block truncate">{eventLabel(event, store.nowMs)}</span>
								<span class="text-ink-muted block text-xs">{deletedAtLabel(event)}</span>
								{#if rowErrors[event.id]}
									<p class="text-danger text-base" role="alert">{rowErrors[event.id]}</p>
								{/if}
							</div>
							<button
								type="button"
								disabled={restoringId === event.id}
								onclick={() => restore(event)}
								aria-label={`Restaurer ${typeLabel(event)} du ${formatTimeOfDay(Date.parse(event.startedAt))}`}
								class="border-border text-ink flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 rounded-control border-2 px-3 py-2 font-semibold active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:active:translate-y-0"
							>
								{#if restoringId === event.id}
									<LoaderCircle
										size={18}
										class="animate-spin motion-reduce:animate-none"
										aria-hidden="true"
									/>
								{:else}
									<RotateCcw size={18} aria-hidden="true" />
								{/if}
								Restaurer
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>
