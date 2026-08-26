<script lang="ts">
	// Shared status/alert live region (issue #52). `nonce` must be bumped by the
	// caller every time `text` is (re)set — including to a value identical to
	// the one already shown — because a live region only announces on DOM
	// change; keying the paragraph on `nonce` forces Svelte to recreate the
	// element so assistive tech re-announces it every time, not just when the
	// text differs from what was already there.
	let {
		text,
		kind,
		nonce,
		id,
		class: className
	}: {
		text: string | null;
		kind: 'status' | 'alert';
		nonce: number;
		id?: string;
		class?: string;
	} = $props();
</script>

{#if text}
	{#key nonce}
		<p {id} role={kind} class={className}>{text}</p>
	{/key}
{/if}
