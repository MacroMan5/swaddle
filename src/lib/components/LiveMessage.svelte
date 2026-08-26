<script lang="ts">
	// Shared status/alert live region (issue #52). The role container itself is
	// always mounted, even with no message: many screen-reader/browser
	// combinations only announce a *change inside* a live region they have
	// already registered, not a region inserted into the DOM after the fact —
	// so an `{#if text}`-gated element would risk the first (and any freshly
	// mounted) outcome going unannounced. `displayed` mirrors `text` but is
	// blanked and reset a frame later whenever `nonce` bumps, which mutates the
	// already-registered region and forces a re-announcement even when the new
	// text is identical to what was already shown.
	//
	// While empty, the element falls back to `sr-only` so it never affects
	// layout (its caller's `class` — spacing, color — only applies once there
	// is text to show).
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

	let displayed = $state<string | null>(null);

	$effect(() => {
		const value = text;
		nonce; // re-run (and re-announce) even when value is unchanged
		if (value === null) {
			displayed = null;
			return;
		}
		displayed = null;
		const frame = requestAnimationFrame(() => {
			displayed = value;
		});
		return () => cancelAnimationFrame(frame);
	});
</script>

<p {id} role={kind} class={displayed !== null ? className : 'sr-only'}>{displayed ?? ''}</p>
