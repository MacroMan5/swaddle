<script lang="ts">
	// Rendered from the layout: a connection loss is only meaningful to report
	// after a first successful snapshot (FR-018).
	import { WifiOff } from '@lucide/svelte';

	let { visible }: { visible: boolean } = $props();
</script>

{#if visible}
	<div
		role="status"
		aria-live="polite"
		class="bg-danger text-on-primary fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium"
	>
		<WifiOff size={16} aria-hidden="true" />
		<span>Connexion perdue — reconnexion…</span>
	</div>
{/if}
