<script lang="ts">
	// Generic toast: a message + a single "Annuler"-style action, auto-dismissing
	// after `duration` ms unless the action is in flight or has failed. Reused by
	// every write flow that needs a soft-undo window (diaper, bottle, ...).
	// Positioning is the caller's job (see +page.svelte's toast stack) so several
	// of these can be stacked at once (item 9).
	import { ApiError } from '$lib/client/api';

	let {
		message,
		actionLabel = 'Annuler',
		onAction,
		onDismiss,
		duration = 5000
	}: {
		message: string;
		actionLabel?: string;
		onAction: () => Promise<void>;
		onDismiss: () => void;
		duration?: number;
	} = $props();

	let pending = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		// Suspend the expiry while an undo is in flight — a slow DELETE landing
		// near the deadline must not dismiss the toast out from under its result
		// — and stay open on failure so the user can retry.
		if (pending || error !== null) return;
		const timer = setTimeout(onDismiss, duration);
		return () => clearTimeout(timer);
	});

	async function handleAction(): Promise<void> {
		if (pending) return;
		pending = true;
		error = null;
		try {
			await onAction();
			pending = false;
			onDismiss();
		} catch (e) {
			pending = false;
			error = e instanceof ApiError ? e.userMessage : 'Impossible d’annuler. Réessayer ?';
		}
	}
</script>

<div
	role="status"
	aria-live="polite"
	class="bg-surface-raised border-border text-ink shadow-md pointer-events-auto mx-auto flex w-full max-w-md flex-col gap-2 rounded-card border px-4 py-3"
>
	<div class="flex items-center justify-between gap-3">
		<span class="text-base">{message}</span>
		<button
			type="button"
			disabled={pending}
			onclick={handleAction}
			class="text-primary min-h-12 min-w-12 rounded-control px-3 py-2 text-base font-semibold active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:active:translate-y-0"
		>
			{pending ? 'Annulation…' : actionLabel}
		</button>
	</div>
	{#if error}
		<p role="alert" class="text-danger text-base">{error}</p>
	{/if}
</div>
