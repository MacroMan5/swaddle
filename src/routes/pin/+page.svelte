<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';

	let pin = $state('');
	let error = $state<string | null>(null);
	let submitting = $state(false);
	let focused = $state(false);

	// A PIN is 4 to 8 digits (FR-015): the boxes grow with the entry instead of
	// promising exactly four.
	const boxCount = $derived(Math.min(8, Math.max(4, pin.length + 1)));

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		submitting = true;
		try {
			const res = await fetch('/api/auth/pin', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ pin })
			});
			if (!res.ok) {
				error = 'Code incorrect';
				return;
			}
			await goto('/');
		} finally {
			submitting = false;
		}
	}
</script>

<div class="bg-surface flex min-h-dvh flex-col p-4">
	<div class="mx-auto flex w-full max-w-sm flex-1 flex-col gap-5">
		<div class="border-border flex items-baseline justify-between border-b-2 pb-3">
			<span class="text-brand text-ink uppercase">Swaddle</span>
		</div>

		<h1 class="text-onboarding-title text-ink">Code PIN</h1>

		<form class="flex flex-col gap-4" onsubmit={submit}>
			<div class="flex flex-col gap-2">
				<Label for="pin" class="text-section text-ink-muted uppercase">Code PIN</Label>
				<!-- The boxes are a costume over one real input (kept fillable and
				     focusable: autocomplete and the numeric keyboard must survive).
				     opacity-0 rather than sr-only so tapping the boxes opens the
				     keyboard reliably on iOS. -->
				<div class="relative">
					<div class="flex gap-2" aria-hidden="true">
						{#each Array.from({ length: boxCount }, (_, i) => i) as i (i)}
							{@const isActive = focused && i === Math.min(pin.length, 7)}
							<div
								class="flex h-[60px] flex-1 items-center justify-center border-2 {isActive
									? 'border-primary'
									: 'border-border'}"
							>
								{#if i < pin.length}
									<span class="bg-ink size-3"></span>
								{:else if isActive}
									<span class="bg-primary h-6 w-0.5 motion-safe:animate-pulse"></span>
								{/if}
							</div>
						{/each}
					</div>
					<input
						id="pin"
						type="password"
						inputmode="numeric"
						autocomplete="current-password"
						required
						maxlength="8"
						bind:value={pin}
						onfocus={() => (focused = true)}
						onblur={() => (focused = false)}
						class="absolute inset-0 h-full w-full opacity-0"
					/>
				</div>
				{#if error}
					<p class="text-danger text-sm">{error}</p>
				{/if}
			</div>
			<Button type="submit" size="lg" class="justify-start" disabled={submitting}
				>Déverrouiller</Button
			>
		</form>
	</div>
</div>
