<script lang="ts">
	// Generic toast: a message + a single "Annuler"-style action, auto-dismissing
	// after `duration` ms. Reused by every write flow that needs a soft-undo
	// window (diaper now, feeding/bottle later).
	let {
		message,
		actionLabel = 'Annuler',
		onAction,
		onDismiss,
		duration = 5000
	}: {
		message: string;
		actionLabel?: string;
		onAction: () => void;
		onDismiss: () => void;
		duration?: number;
	} = $props();

	$effect(() => {
		const timer = setTimeout(onDismiss, duration);
		return () => clearTimeout(timer);
	});

	function handleAction(): void {
		onAction();
		onDismiss();
	}
</script>

<div
	role="status"
	aria-live="polite"
	class="bg-surface-raised border-border text-ink shadow-card fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-card border px-4 py-3"
>
	<span>{message}</span>
	<button
		type="button"
		onclick={handleAction}
		class="text-primary min-h-12 min-w-12 rounded-control px-3 py-2 font-semibold active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:active:scale-100"
	>
		{actionLabel}
	</button>
</div>
