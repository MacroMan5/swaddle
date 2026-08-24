<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let pin = $state('');
	let error = $state<string | null>(null);
	let submitting = $state(false);

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

<div class="flex min-h-dvh items-center justify-center bg-surface p-4">
	<Card.Root class="w-full max-w-sm">
		<Card.Header>
			<Card.Title class="text-2xl">Code PIN</Card.Title>
		</Card.Header>
		<Card.Content>
			<form class="flex flex-col gap-4" onsubmit={submit}>
				<div class="flex flex-col gap-2">
					<Label for="pin">Code PIN</Label>
					<Input
						id="pin"
						type="password"
						inputmode="numeric"
						autocomplete="current-password"
						class="min-h-12 text-base"
						bind:value={pin}
						required
					/>
					{#if error}
						<p class="text-sm text-danger">{error}</p>
					{/if}
				</div>
				<Button type="submit" class="min-h-12" disabled={submitting}>Déverrouiller</Button>
			</form>
		</Card.Content>
	</Card.Root>
</div>
