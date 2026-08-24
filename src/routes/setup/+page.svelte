<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowRight } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
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

<div class="bg-surface flex min-h-dvh flex-col p-4">
	<div class="enter mx-auto flex w-full max-w-sm flex-1 flex-col gap-5">
		<!-- Brand band. The repo has no symbol yet — the wordmark carries it. -->
		<div class="border-border flex items-baseline justify-between border-b-2 pb-3">
			<span class="text-brand text-ink uppercase">Swaddle</span>
			<span class="text-tile-hint text-ink-muted uppercase tabular-nums">Étape {step} / 2</span>
		</div>
		<div class="bg-border-hair h-1" aria-hidden="true">
			<div class="bg-primary h-1" style:width={step === 1 ? '50%' : '100%'}></div>
		</div>

		{#if step === 1}
			<h1 class="text-onboarding-title text-ink">Votre bébé</h1>
			<p class="text-body text-ink-muted max-w-[300px] text-pretty">
				Swaddle garde tout ici, chez vous : rien ne quitte votre réseau local.
			</p>
			<form class="flex flex-col gap-4" onsubmit={submitBaby}>
				<div class="flex flex-col gap-2">
					<Label for="baby-name" class="text-section text-ink-muted uppercase">Prénom</Label>
					<Input
						id="baby-name"
						class="text-field-lg"
						bind:value={babyName}
						required
						maxlength={100}
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="baby-birthdate" class="text-section text-ink-muted uppercase"
						>Date de naissance</Label
					>
					<Input id="baby-birthdate" type="date" class="text-field-lg" bind:value={birthdate} required />
				</div>
				{#if babyError}
					<p class="text-danger text-sm">{babyError}</p>
				{/if}
				<Button type="submit" size="lg" class="justify-between" disabled={babySubmitting}>
					Continuer
					<ArrowRight size={20} aria-hidden="true" />
				</Button>
			</form>
		{:else}
			<h1 class="text-onboarding-title text-ink">Qui s'en occupe ?</h1>
			<form class="flex flex-col gap-4" onsubmit={submitCaregiver}>
				<div class="flex flex-col gap-2">
					<Label for="caregiver-name" class="text-section text-ink-muted uppercase">Prénom</Label>
					<Input
						id="caregiver-name"
						class="text-field-lg"
						bind:value={caregiverName}
						required
						maxlength={100}
					/>
				</div>
				<div class="flex flex-col gap-2">
					<span id="caregiver-color-label" class="text-section text-ink-muted uppercase">Couleur</span>
					<div class="flex flex-wrap gap-2" role="group" aria-labelledby="caregiver-color-label">
						{#each CAREGIVER_COLORS as color (color)}
							<button
								type="button"
								class="size-12 border-2"
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
					<p class="text-danger text-sm">{caregiverError}</p>
				{/if}
				<Button type="submit" size="lg" class="justify-between" disabled={caregiverSubmitting}>
					Terminer
					<ArrowRight size={20} aria-hidden="true" />
				</Button>
			</form>
		{/if}
	</div>
</div>
