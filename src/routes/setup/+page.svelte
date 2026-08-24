<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { errorMessage } from '$lib/errors';
	import { CAREGIVER_COLORS, caregiverColorName } from '$lib/palette';

	let { data } = $props();

	let step = $state<1 | 2>(data.hasBaby ? 2 : 1);

	let babyName = $state('');
	let birthdate = $state('');
	let babyError = $state<string | null>(null);
	let babySubmitting = $state(false);

	let caregiverName = $state('');
	let caregiverColor = $state(CAREGIVER_COLORS[0]);
	let caregiverError = $state<string | null>(null);
	let caregiverSubmitting = $state(false);

	async function submitBaby(event: SubmitEvent) {
		event.preventDefault();
		babyError = null;
		babySubmitting = true;
		try {
			const res = await fetch('/api/babies', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: babyName, birthdate })
			});
			const data = await res.json();
			if (!res.ok) {
				babyError = errorMessage(data);
				return;
			}
			step = 2;
		} finally {
			babySubmitting = false;
		}
	}

	async function submitCaregiver(event: SubmitEvent) {
		event.preventDefault();
		caregiverError = null;
		caregiverSubmitting = true;
		try {
			const res = await fetch('/api/caregivers', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: caregiverName, color: caregiverColor })
			});
			const data = await res.json();
			if (!res.ok) {
				caregiverError = errorMessage(data);
				return;
			}
			localStorage.setItem('swaddle.caregiverId', data.id);
			await goto('/');
		} finally {
			caregiverSubmitting = false;
		}
	}
</script>

<div class="flex min-h-dvh items-center justify-center bg-surface p-4">
	<Card.Root class="w-full max-w-sm">
		{#if step === 1}
			<Card.Header>
				<Card.Title class="font-serif text-2xl">Votre bébé</Card.Title>
			</Card.Header>
			<Card.Content>
				<form class="flex flex-col gap-4" onsubmit={submitBaby}>
					<div class="flex flex-col gap-2">
						<Label for="baby-name">Prénom</Label>
						<Input
							id="baby-name"
							class="min-h-12 text-base"
							bind:value={babyName}
							required
							maxlength={100}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="baby-birthdate">Date de naissance</Label>
						<Input
							id="baby-birthdate"
							type="date"
							class="min-h-12 text-base"
							bind:value={birthdate}
							required
						/>
					</div>
					{#if babyError}
						<p class="text-sm text-danger">{babyError}</p>
					{/if}
					<Button type="submit" class="min-h-12" disabled={babySubmitting}>Continuer</Button>
				</form>
			</Card.Content>
		{:else}
			<Card.Header>
				<Card.Title class="font-serif text-2xl">Qui s'en occupe ?</Card.Title>
			</Card.Header>
			<Card.Content>
				<form class="flex flex-col gap-4" onsubmit={submitCaregiver}>
					<div class="flex flex-col gap-2">
						<Label for="caregiver-name">Prénom</Label>
						<Input
							id="caregiver-name"
							class="min-h-12 text-base"
							bind:value={caregiverName}
							required
							maxlength={100}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<span id="caregiver-color-label" class="text-sm font-medium text-ink">Couleur</span>
						<div class="flex flex-wrap gap-2" role="group" aria-labelledby="caregiver-color-label">
							{#each CAREGIVER_COLORS as color (color)}
								<button
									type="button"
									class="size-12 rounded-full border-2"
									style:background-color={color}
									style:border-color={caregiverColor === color ? 'var(--ink)' : 'transparent'}
									aria-label={caregiverColorName(color)}
									aria-pressed={caregiverColor === color}
									onclick={() => (caregiverColor = color)}
								></button>
							{/each}
						</div>
					</div>
					{#if caregiverError}
						<p class="text-sm text-danger">{caregiverError}</p>
					{/if}
					<Button type="submit" class="min-h-12" disabled={caregiverSubmitting}>Terminer</Button>
				</form>
			</Card.Content>
		{/if}
	</Card.Root>
</div>
