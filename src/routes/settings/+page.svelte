<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { errorMessage } from '$lib/errors';
	import { CAREGIVER_COLORS, caregiverColorName } from '$lib/palette';

	let { data } = $props();

	// Catches transport failures (connection loss: `fetch` itself rejects) and a
	// malformed response body (`res.json()` throws): without this, a caller
	// like setVolumeUnit — which applies its change optimistically before
	// awaiting this — would throw instead of reaching its rollback/error
	// branch, leaving the optimistic write stuck with no error shown (FR-018).
	async function postJson(url: string, method: string, body?: unknown) {
		try {
			const res = await fetch(url, {
				method,
				headers: body === undefined ? undefined : { 'content-type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			const value = res.status === 204 ? null : await res.json();
			return { ok: res.ok, value };
		} catch {
			return { ok: false, value: null };
		}
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
	let volumeUnitError = $state<string | null>(null);
	let volumeUnitPending = $state(false);

	async function setVolumeUnit(unit: 'ml' | 'oz') {
		volumeUnitError = null;
		const previousUnit = volumeUnit;
		// Applied immediately for instant feedback (design-system.md § Mouvement);
		// rolled back below if the save turns out to have failed, instead of
		// presenting an unsaved change as persistent. Both buttons are disabled
		// meanwhile so a second click can't start a concurrent save whose
		// rollback would race this one's.
		volumeUnit = unit;
		volumeUnitPending = true;

		const { ok, value } = await postJson('/api/household', 'PATCH', { volumeUnit: unit });
		volumeUnitPending = false;
		if (!ok) {
			volumeUnit = previousUnit;
			volumeUnitError = errorMessage(value);
		}
	}

	// --- Thème ---
	let theme = $state(data.household.theme);
	let themeError = $state<string | null>(null);

	function applyTheme(t: 'light' | 'dark' | 'auto') {
		const dark =
			t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
		document.documentElement.classList.toggle('dark', dark);
	}

	async function setTheme(t: 'light' | 'dark' | 'auto') {
		themeError = null;
		const previousTheme = theme;
		const previousStoredTheme = localStorage.getItem('swaddle.theme');
		// Applied immediately for instant feedback (design-system.md § Mouvement);
		// rolled back below if the save turns out to have failed, instead of
		// presenting an unsaved change as persistent.
		applyTheme(t);
		localStorage.setItem('swaddle.theme', t);

		const { ok, value } = await postJson('/api/household', 'PATCH', { theme: t });
		if (!ok) {
			applyTheme(previousTheme);
			if (previousStoredTheme === null) localStorage.removeItem('swaddle.theme');
			else localStorage.setItem('swaddle.theme', previousStoredTheme);
			themeError = errorMessage(value);
			return;
		}
		theme = t;
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
	let restoreInput: HTMLInputElement | null = null;

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

	// --- Sauvegarde ---
	// Fetched (not a plain download link) so the freshly written snapshot can
	// refresh « Dernière sauvegarde » via invalidateAll once the response lands.
	let backupPending = $state(false);
	let backupError = $state<string | null>(null);

	async function downloadBackup() {
		if (backupPending) return;
		backupPending = true;
		backupError = null;
		try {
			const res = await fetch('/api/backup');
			if (!res.ok) {
				backupError = 'Une erreur est survenue.';
				return;
			}
			const blob = await res.blob();
			const match = /filename="?([^";]+)/.exec(res.headers.get('content-disposition') ?? '');
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = match?.[1] ?? 'swaddle-backup.sqlite';
			a.click();
			URL.revokeObjectURL(url);
			await invalidateAll();
		} catch {
			backupError = 'Une erreur est survenue.';
		} finally {
			backupPending = false;
		}
	}

	// --- Ce serveur ---
	const lastBackupLabel = $derived.by(() => {
		const at = data.serverInfo.lastBackupAt;
		if (at === null) return 'jamais';
		return new Date(at).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });
	});
</script>

<div class="mx-auto flex max-w-lg flex-col gap-4 p-4">
	<div class="border-border enter border-b-2 pb-3">
		<h1 class="text-screen-title text-ink">Réglages</h1>
	</div>

	<!-- One surface cut by rules: 2px between groups, hairlines inside them. -->
	<div class="bg-surface-raised border-border divide-border enter divide-y-2 border-2" style="--enter-delay: 60ms">
		<section class="flex flex-col gap-3 p-4">
			<h2 class="text-section text-ink-muted uppercase">Foyer</h2>

			<div class="divide-border-hair divide-y">
				{#each data.babies as baby (baby.id)}
					<div class="flex items-baseline justify-between gap-4 py-2">
						<span class="text-label text-ink-label">Bébé</span>
						<span class="text-value text-ink tabular-nums">{baby.name} · {baby.birthdate}</span>
					</div>
				{:else}
					<p class="text-ink-muted py-2">Aucun bébé enregistré.</p>
				{/each}

				<div class="flex flex-col gap-2 py-2">
					<span class="text-label text-ink-label">Unité</span>
					<div class="flex gap-2">
						<Button
							type="button"
							class="min-h-12 flex-1"
							disabled={volumeUnitPending}
							variant={volumeUnit === 'ml' ? 'default' : 'outline'}
							onclick={() => setVolumeUnit('ml')}>ml</Button
						>
						<Button
							type="button"
							class="min-h-12 flex-1"
							disabled={volumeUnitPending}
							variant={volumeUnit === 'oz' ? 'default' : 'outline'}
							onclick={() => setVolumeUnit('oz')}>oz</Button
						>
					</div>
					{#if volumeUnitError}<p class="text-danger text-sm">{volumeUnitError}</p>{/if}
				</div>

				<div class="flex flex-col gap-2 py-2">
					<span class="text-label text-ink-label">Thème</span>
					<div class="flex gap-2">
						<Button
							type="button"
							class="min-h-12 flex-1"
							variant={theme === 'light' ? 'default' : 'outline'}
							onclick={() => setTheme('light')}>Clair</Button
						>
						<Button
							type="button"
							class="min-h-12 flex-1"
							variant={theme === 'dark' ? 'default' : 'outline'}
							onclick={() => setTheme('dark')}>Sombre</Button
						>
						<Button
							type="button"
							class="min-h-12 flex-1"
							variant={theme === 'auto' ? 'default' : 'outline'}
							onclick={() => setTheme('auto')}>Auto</Button
						>
					</div>
					{#if themeError}<p class="text-danger text-sm">{themeError}</p>{/if}
				</div>
			</div>
		</section>

		<section class="flex flex-col gap-3 p-4">
			<h2 class="text-section text-ink-muted uppercase">Aidants</h2>

			<ul class="divide-border-hair flex flex-col divide-y">
				{#each data.caregivers as cg (cg.id)}
					<li class="flex flex-col gap-2 py-2">
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
											class="size-12 border-2"
											style:background-color={color}
											style:border-color={editCaregiverColor === color ? 'var(--ink)' : 'transparent'}
											aria-label={caregiverColorName(color)}
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
							<div class="flex items-center gap-3">
								<span class="size-3 shrink-0" style:background-color={cg.color}></span>
								<span class="text-value text-ink flex-1">{cg.name}</span>
								<Button
									variant="outline"
									class="min-h-12"
									aria-label={`Modifier ${cg.name}`}
									onclick={() => startEditCaregiver(cg)}>Modifier</Button
								>
								<Button
									variant="ghost"
									class="text-danger min-h-12"
									aria-label={`Supprimer ${cg.name}`}
									onclick={() => deleteCaregiver(cg.id)}>Supprimer</Button
								>
							</div>
						{/if}
					</li>
				{/each}
			</ul>

			<form class="border-border-hair flex flex-col gap-2 border-t pt-3" onsubmit={addCaregiver}>
				<Label for="new-caregiver-name">Nom de l’aidant</Label>
				<Input id="new-caregiver-name" class="min-h-12 text-base" bind:value={newCaregiverName} required />
				<div class="flex flex-wrap gap-2">
					{#each CAREGIVER_COLORS as color (color)}
						<button
							type="button"
							class="size-12 border-2"
							style:background-color={color}
							style:border-color={newCaregiverColor === color ? 'var(--ink)' : 'transparent'}
							aria-label={caregiverColorName(color)}
							aria-pressed={newCaregiverColor === color}
							onclick={() => (newCaregiverColor = color)}
						></button>
					{/each}
				</div>
				{#if caregiverError}<p class="text-danger text-sm">{caregiverError}</p>{/if}
				<Button type="submit" class="min-h-12">Ajouter un aidant</Button>
			</form>

			<div class="border-border-hair flex flex-col gap-1 border-t pt-3">
				<h3 class="text-section text-ink-muted uppercase">Cet appareil</h3>
				<p class="text-ink-muted text-body">Qui utilise cet appareil ?</p>
				<div class="flex flex-col">
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
							<label for={`device-${cg.id}`} class="text-ink min-h-12 flex-1 py-3">{cg.name}</label>
						</div>
					{/each}
				</div>
			</div>
		</section>

		<section class="flex flex-col gap-3 p-4">
			<h2 class="text-section text-ink-muted uppercase">Sécurité</h2>

			<div class="flex items-center justify-between gap-4">
				<span class="text-value text-ink">Code PIN {pinEnabled ? 'activé' : 'désactivé'}</span>
				<!-- Visual state indicator only — enabling/disabling goes through the
				     forms below, which require the current code. -->
				<span
					class="border-border flex h-6 w-11 shrink-0 items-center border-2 px-0.5 {pinEnabled
						? 'bg-primary justify-end'
						: 'bg-surface justify-start'}"
					aria-hidden="true"
				>
					<span class="size-4 {pinEnabled ? 'bg-on-primary' : 'bg-ink-muted'}"></span>
				</span>
			</div>

			{#if pinEnabled}
				<form class="border-border-hair flex flex-col gap-2 border-t pt-3" onsubmit={enablePin}>
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
				<form class="border-border-hair flex flex-col gap-2 border-t pt-3" onsubmit={disablePin}>
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
				<form class="border-border-hair flex flex-col gap-2 border-t pt-3" onsubmit={enablePin}>
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
			{#if pinError}<p class="text-danger text-sm">{pinError}</p>{/if}
			{#if pinMessage}<p class="text-ink-muted text-sm">{pinMessage}</p>{/if}
		</section>

		<section class="flex flex-col gap-3 p-4">
			<h2 class="text-section text-ink-muted uppercase">Vos données</h2>
			<div class="grid grid-cols-2 gap-2.5">
				<Button href="/api/export/json" download variant="outline" class="h-auto min-h-13 justify-start whitespace-normal py-2 text-left"
					>Exporter JSON</Button
				>
				<Button href="/api/export/csv" download variant="outline" class="h-auto min-h-13 justify-start whitespace-normal py-2 text-left"
					>Exporter CSV</Button
				>
				<Button
					variant="outline"
					disabled={backupPending}
					onclick={downloadBackup}
					class="h-auto min-h-13 justify-start whitespace-normal py-2 text-left"
					>Télécharger une sauvegarde</Button
				>
				<!-- The native file input is visually hidden (its "Choose file / No file
				     chosen" widget is browser-chrome English): the styled button opens it. -->
				<input
					bind:this={restoreInput}
					id="restore-file"
					type="file"
					accept=".json"
					class="sr-only"
					tabindex="-1"
					aria-hidden="true"
					onchange={restoreFile}
				/>
				<Button
					variant="outline"
					class="text-primary-text h-auto min-h-13 justify-start whitespace-normal py-2 text-left"
					onclick={() => restoreInput?.click()}>Restaurer depuis un fichier…</Button
				>
			</div>
			{#if backupError}<p class="text-danger text-sm">{backupError}</p>{/if}
			{#if restoreError}<p class="text-danger text-sm">{restoreError}</p>{/if}
			{#if restoreMessage}<p class="text-ink-muted text-sm">{restoreMessage}</p>{/if}
		</section>

		<section class="flex flex-col gap-1 p-4">
			<h2 class="text-section text-ink-muted uppercase">Ce serveur</h2>
			<dl class="divide-border-hair divide-y">
				<div class="flex items-baseline justify-between gap-4 py-2">
					<dt class="text-label text-ink-label">Adresse</dt>
					<dd class="text-value text-ink truncate tabular-nums">{data.serverInfo.address}</dd>
				</div>
				<div class="flex items-baseline justify-between gap-4 py-2">
					<dt class="text-label text-ink-label">Appareils connectés</dt>
					<dd class="text-value text-ink tabular-nums">{data.serverInfo.connectedDevices}</dd>
				</div>
				<div class="flex items-baseline justify-between gap-4 py-2">
					<dt class="text-label text-ink-label">Dernière sauvegarde</dt>
					<dd class="text-value text-ink tabular-nums">{lastBackupLabel}</dd>
				</div>
			</dl>
		</section>
	</div>
</div>
