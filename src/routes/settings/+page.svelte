<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { errorMessage } from '$lib/errors';
	import { CAREGIVER_COLORS } from '$lib/palette';

	let { data } = $props();

	async function postJson(url: string, method: string, body?: unknown) {
		const res = await fetch(url, {
			method,
			headers: body === undefined ? undefined : { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const value = res.status === 204 ? null : await res.json();
		return { ok: res.ok, value };
	}

	// --- Aidants ---
	let newCaregiverName = $state('');
	let newCaregiverColor = $state(CAREGIVER_COLORS[0]);
	let caregiverError = $state<string | null>(null);

	async function addCaregiver(event: SubmitEvent) {
		event.preventDefault();
		caregiverError = null;
		const { ok, value } = await postJson('/api/caregivers', 'POST', {
			name: newCaregiverName,
			color: newCaregiverColor
		});
		if (!ok) {
			caregiverError = errorMessage(value);
			return;
		}
		newCaregiverName = '';
		await invalidateAll();
	}

	async function deleteCaregiver(id: string) {
		const { ok, value } = await postJson(`/api/caregivers/${id}`, 'DELETE');
		if (!ok) {
			caregiverError = errorMessage(value);
			return;
		}
		await invalidateAll();
	}

	let editingCaregiverId = $state<string | null>(null);
	let editCaregiverName = $state('');
	let editCaregiverColor = $state('');

	function startEditCaregiver(cg: { id: string; name: string; color: string }) {
		editingCaregiverId = cg.id;
		editCaregiverName = cg.name;
		editCaregiverColor = cg.color;
		caregiverError = null;
	}

	function cancelEditCaregiver() {
		editingCaregiverId = null;
	}

	async function saveCaregiver(event: SubmitEvent, id: string) {
		event.preventDefault();
		caregiverError = null;
		const { ok, value } = await postJson(`/api/caregivers/${id}`, 'PATCH', {
			name: editCaregiverName,
			color: editCaregiverColor
		});
		if (!ok) {
			caregiverError = errorMessage(value);
			return;
		}
		editingCaregiverId = null;
		await invalidateAll();
	}

	// --- Cet appareil ---
	let deviceCaregiverId = $state(
		typeof window !== 'undefined' ? localStorage.getItem('swaddle.caregiverId') : null
	);

	function selectDeviceCaregiver(id: string) {
		deviceCaregiverId = id;
		localStorage.setItem('swaddle.caregiverId', id);
	}

	// --- Unité ---
	let volumeUnit = $state(data.household.volumeUnit);

	async function setVolumeUnit(unit: 'ml' | 'oz') {
		volumeUnit = unit;
		await postJson('/api/household', 'PATCH', { volumeUnit: unit });
	}

	// --- Thème ---
	let theme = $state(data.household.theme);

	function applyTheme(t: 'light' | 'dark' | 'auto') {
		const dark =
			t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
		document.documentElement.classList.toggle('dark', dark);
	}

	async function setTheme(t: 'light' | 'dark' | 'auto') {
		theme = t;
		localStorage.setItem('swaddle.theme', t);
		applyTheme(t);
		await postJson('/api/household', 'PATCH', { theme: t });
	}

	// --- Code PIN ---
	let pinEnabled = $state(data.household.pinEnabled);
	let newPin = $state('');
	let newPinConfirm = $state('');
	let currentPin = $state('');
	let pinError = $state<string | null>(null);
	let pinMessage = $state<string | null>(null);

	async function enablePin(event: SubmitEvent) {
		event.preventDefault();
		pinError = null;
		pinMessage = null;
		if (newPin !== newPinConfirm) {
			pinError = 'Les deux codes ne correspondent pas.';
			return;
		}
		const { ok, value } = await postJson('/api/household/pin', 'PUT', {
			pin: newPin,
			currentPin: currentPin || undefined
		});
		if (!ok) {
			pinError = errorMessage(value);
			return;
		}
		pinEnabled = true;
		newPin = '';
		newPinConfirm = '';
		currentPin = '';
		pinMessage = 'Code PIN mis à jour.';
	}

	async function disablePin(event: SubmitEvent) {
		event.preventDefault();
		pinError = null;
		pinMessage = null;
		const { ok, value } = await postJson('/api/household/pin', 'DELETE', { currentPin });
		if (!ok) {
			pinError = errorMessage(value);
			return;
		}
		pinEnabled = false;
		currentPin = '';
		pinMessage = 'Code PIN désactivé.';
	}

	// --- Données ---
	let restoreMessage = $state<string | null>(null);
	let restoreError = $state<string | null>(null);

	async function restoreFile(event: Event) {
		restoreMessage = null;
		restoreError = null;
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const text = await file.text();
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			restoreError = 'Fichier JSON invalide.';
			input.value = '';
			return;
		}
		if (!confirm('Cette action remplace toutes les données actuelles par celles du fichier. Continuer ?')) {
			input.value = '';
			return;
		}
		const { ok, value } = await postJson('/api/restore', 'POST', parsed);
		input.value = '';
		if (!ok) {
			restoreError = errorMessage(value);
			return;
		}
		const { babies, caregivers, events } = value.restored;
		restoreMessage = `Restauré : ${babies} bébé(s), ${caregivers} aidant(s), ${events} événement(s).`;
		await invalidateAll();
	}
</script>

<div class="mx-auto flex max-w-lg flex-col gap-4 p-4">
	<h1 class="font-serif text-2xl text-ink">Réglages</h1>

	<Card.Root>
		<Card.Header><Card.Title>Bébé</Card.Title></Card.Header>
		<Card.Content>
			{#each data.babies as baby (baby.id)}
				<p class="text-ink">{baby.name} — né(e) le {baby.birthdate}</p>
			{:else}
				<p class="text-ink-muted">Aucun bébé enregistré.</p>
			{/each}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header><Card.Title>Aidants</Card.Title></Card.Header>
		<Card.Content class="flex flex-col gap-4">
			<ul class="flex flex-col gap-2">
				{#each data.caregivers as cg (cg.id)}
					<li class="flex flex-col gap-2">
						{#if editingCaregiverId === cg.id}
							<form class="flex flex-col gap-2" onsubmit={(e) => saveCaregiver(e, cg.id)}>
								<Label for={`edit-caregiver-name-${cg.id}`}>Nouveau nom pour {cg.name}</Label>
								<Input
									id={`edit-caregiver-name-${cg.id}`}
									class="min-h-12 text-base"
									bind:value={editCaregiverName}
									required
								/>
								<div class="flex flex-wrap gap-2">
									{#each CAREGIVER_COLORS as color (color)}
										<button
											type="button"
											class="size-12 rounded-full border-2"
											style:background-color={color}
											style:border-color={editCaregiverColor === color ? 'var(--ink)' : 'transparent'}
											aria-label={color}
											aria-pressed={editCaregiverColor === color}
											onclick={() => (editCaregiverColor = color)}
										></button>
									{/each}
								</div>
								<div class="flex gap-2">
									<Button type="submit" class="min-h-12">Enregistrer</Button>
									<Button
										type="button"
										variant="outline"
										class="min-h-12"
										onclick={cancelEditCaregiver}>Annuler</Button
									>
								</div>
							</form>
						{:else}
							<div class="flex items-center gap-2">
								<span class="size-4 rounded-full" style:background-color={cg.color}></span>
								<span class="flex-1 text-ink">{cg.name}</span>
								<Button
									variant="outline"
									class="min-h-12"
									aria-label={`Modifier ${cg.name}`}
									onclick={() => startEditCaregiver(cg)}>Modifier</Button
								>
								<Button variant="ghost" class="min-h-12" onclick={() => deleteCaregiver(cg.id)}
									>Supprimer</Button
								>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
			<form class="flex flex-col gap-2" onsubmit={addCaregiver}>
				<Label for="new-caregiver-name">Nom de l’aidant</Label>
				<Input id="new-caregiver-name" class="min-h-12 text-base" bind:value={newCaregiverName} required />
				<div class="flex flex-wrap gap-2">
					{#each CAREGIVER_COLORS as color (color)}
						<button
							type="button"
							class="size-12 rounded-full border-2"
							style:background-color={color}
							style:border-color={newCaregiverColor === color ? 'var(--ink)' : 'transparent'}
							aria-label={color}
							aria-pressed={newCaregiverColor === color}
							onclick={() => (newCaregiverColor = color)}
						></button>
					{/each}
				</div>
				{#if caregiverError}<p class="text-sm text-danger">{caregiverError}</p>{/if}
				<Button type="submit" class="min-h-12">Ajouter un aidant</Button>
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header><Card.Title>Cet appareil</Card.Title></Card.Header>
		<Card.Content>
			<p class="mb-2 text-ink-muted">Qui utilise cet appareil ?</p>
			<div class="flex flex-col gap-2">
				{#each data.caregivers as cg (cg.id)}
					<div class="flex items-center gap-2">
						<input
							type="radio"
							id={`device-${cg.id}`}
							name="device-caregiver"
							class="size-6"
							checked={deviceCaregiverId === cg.id}
							onchange={() => selectDeviceCaregiver(cg.id)}
						/>
						<label for={`device-${cg.id}`} class="min-h-12 py-2 text-ink">{cg.name}</label>
					</div>
				{/each}
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header><Card.Title>Unité</Card.Title></Card.Header>
		<Card.Content class="flex gap-2">
			<Button
				type="button"
				class="min-h-12"
				variant={volumeUnit === 'ml' ? 'default' : 'outline'}
				onclick={() => setVolumeUnit('ml')}>ml</Button
			>
			<Button
				type="button"
				class="min-h-12"
				variant={volumeUnit === 'oz' ? 'default' : 'outline'}
				onclick={() => setVolumeUnit('oz')}>oz</Button
			>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header><Card.Title>Thème</Card.Title></Card.Header>
		<Card.Content class="flex gap-2">
			<Button
				type="button"
				class="min-h-12"
				variant={theme === 'light' ? 'default' : 'outline'}
				onclick={() => setTheme('light')}>Clair</Button
			>
			<Button
				type="button"
				class="min-h-12"
				variant={theme === 'dark' ? 'default' : 'outline'}
				onclick={() => setTheme('dark')}>Sombre</Button
			>
			<Button
				type="button"
				class="min-h-12"
				variant={theme === 'auto' ? 'default' : 'outline'}
				onclick={() => setTheme('auto')}>Auto</Button
			>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header><Card.Title>Code PIN</Card.Title></Card.Header>
		<Card.Content class="flex flex-col gap-4">
			{#if pinEnabled}
				<form class="flex flex-col gap-2" onsubmit={enablePin}>
					<p class="text-ink-muted">Changer le code</p>
					<Label for="current-pin">Code actuel</Label>
					<Input
						id="current-pin"
						type="password"
						inputmode="numeric"
						class="min-h-12 text-base"
						bind:value={currentPin}
						required
					/>
					<Label for="new-pin">Nouveau code (4 à 8 chiffres)</Label>
					<Input
						id="new-pin"
						type="password"
						inputmode="numeric"
						class="min-h-12 text-base"
						bind:value={newPin}
						required
					/>
					<Label for="new-pin-confirm">Confirmer le nouveau code</Label>
					<Input
						id="new-pin-confirm"
						type="password"
						inputmode="numeric"
						class="min-h-12 text-base"
						bind:value={newPinConfirm}
						required
					/>
					<Button type="submit" class="min-h-12">Changer le code</Button>
				</form>
				<form class="flex flex-col gap-2" onsubmit={disablePin}>
					<Label for="disable-current-pin">Code actuel (pour désactiver)</Label>
					<Input
						id="disable-current-pin"
						type="password"
						inputmode="numeric"
						class="min-h-12 text-base"
						bind:value={currentPin}
						required
					/>
					<Button type="submit" variant="destructive" class="min-h-12">Désactiver le code PIN</Button>
				</form>
			{:else}
				<form class="flex flex-col gap-2" onsubmit={enablePin}>
					<Label for="new-pin">Nouveau code (4 à 8 chiffres)</Label>
					<Input
						id="new-pin"
						type="password"
						inputmode="numeric"
						class="min-h-12 text-base"
						bind:value={newPin}
						required
					/>
					<Label for="new-pin-confirm">Confirmer le code</Label>
					<Input
						id="new-pin-confirm"
						type="password"
						inputmode="numeric"
						class="min-h-12 text-base"
						bind:value={newPinConfirm}
						required
					/>
					<Button type="submit" class="min-h-12">Activer le code PIN</Button>
				</form>
			{/if}
			{#if pinError}<p class="text-sm text-danger">{pinError}</p>{/if}
			{#if pinMessage}<p class="text-sm text-ink-muted">{pinMessage}</p>{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header><Card.Title>Données</Card.Title></Card.Header>
		<Card.Content class="flex flex-col gap-2">
			<Button href="/api/export/json" download class="min-h-12">Exporter JSON</Button>
			<Button href="/api/export/csv" download class="min-h-12">Exporter CSV</Button>
			<Button href="/api/backup" download class="min-h-12">Télécharger une sauvegarde</Button>
			<div class="flex flex-col gap-2">
				<Label for="restore-file">Restaurer depuis un fichier</Label>
				<input
					id="restore-file"
					type="file"
					accept=".json"
					class="min-h-12"
					onchange={restoreFile}
				/>
			</div>
			{#if restoreError}<p class="text-sm text-danger">{restoreError}</p>{/if}
			{#if restoreMessage}<p class="text-sm text-ink-muted">{restoreMessage}</p>{/if}
		</Card.Content>
	</Card.Root>
</div>
