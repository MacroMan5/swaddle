<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { errorMessage, userMessage } from '$lib/errors';
	import { MAX_BODY_BYTES } from '$lib/limits';
	import { pageTitle } from '$lib/meta';
	import { applyForcedThemeColor } from '$lib/client/themeColor';
	import { reconcileStoredCaregiverId, setStoredCaregiverId } from '$lib/client/caregiverSelection';
	import { CAREGIVER_COLORS, caregiverColorName } from '$lib/palette';
	import LiveMessage from '$lib/components/LiveMessage.svelte';

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

	// --- Bébé (#46) ---
	let editingBabyId = $state<string | null>(null);
	let editBabyName = $state('');
	let editBabyBirthdate = $state('');
	let babyError = $state<string | null>(null);
	// The id of the baby the last successful save applied to, so the
	// confirmation only appears next to that baby (there is normally just
	// one, but nothing here should assume it).
	let babySuccessId = $state<string | null>(null);
	let babyPending = $state(false);
	// Bumped on every (re)set of babyError/babySuccessId so a repeated identical
	// outcome — e.g. saving twice in a row and getting the same success or error
	// message — is announced again (see LiveMessage.svelte).
	let babyErrorNonce = $state(0);
	let babySuccessNonce = $state(0);

	function startEditBaby(baby: { id: string; name: string; birthdate: string }) {
		editingBabyId = baby.id;
		editBabyName = baby.name;
		editBabyBirthdate = baby.birthdate;
		babyError = null;
		babySuccessId = null;
	}

	function cancelEditBaby() {
		editingBabyId = null;
	}

	async function saveBaby(event: SubmitEvent, id: string) {
		event.preventDefault();
		babyError = null;
		babySuccessId = null;
		babyPending = true;
		const { ok, value } = await postJson(`/api/babies/${id}`, 'PATCH', {
			name: editBabyName,
			birthdate: editBabyBirthdate
		});
		babyPending = false;
		if (!ok) {
			babyError = errorMessage(value);
			babyErrorNonce++;
			return;
		}
		editingBabyId = null;
		babySuccessId = id;
		babySuccessNonce++;
		await invalidateAll();
	}

	// --- Aidants ---
	let newCaregiverName = $state('');
	let newCaregiverColor = $state(CAREGIVER_COLORS[0]);
	let caregiverError = $state<string | null>(null);
	// Which operation the current caregiverError belongs to, so only the
	// input that actually caused it gets aria-invalid/aria-describedby: a
	// rejected edit or delete must not also mark the unrelated "add" name
	// field invalid, and vice-versa (issue #52). Delete has no input of its
	// own — its failure is announced through the alert region only.
	let caregiverErrorSource = $state<'add' | 'edit' | 'delete' | null>(null);
	// sr-only confirmation (add/edit/delete give no visible confirmation text —
	// the list update is itself the visual feedback) so successes are still
	// announced (issue #52).
	let caregiverStatus = $state<string | null>(null);
	let caregiverErrorNonce = $state(0);
	let caregiverStatusNonce = $state(0);

	async function addCaregiver(event: SubmitEvent) {
		event.preventDefault();
		caregiverError = null;
		caregiverErrorSource = null;
		const addedName = newCaregiverName;
		const { ok, value } = await postJson('/api/caregivers', 'POST', {
			name: addedName,
			color: newCaregiverColor
		});
		if (!ok) {
			caregiverError = errorMessage(value);
			caregiverErrorSource = 'add';
			caregiverErrorNonce++;
			return;
		}
		newCaregiverName = '';
		caregiverStatus = `Aidant ${addedName} ajouté.`;
		caregiverStatusNonce++;
		await invalidateAll();
	}

	async function deleteCaregiver(id: string, name: string) {
		const { ok, value } = await postJson(`/api/caregivers/${id}`, 'DELETE');
		if (!ok) {
			caregiverError = errorMessage(value);
			caregiverErrorSource = 'delete';
			caregiverErrorNonce++;
			return;
		}
		caregiverStatus = `Aidant ${name} supprimé.`;
		caregiverStatusNonce++;
		await invalidateAll();
		// Reconcile immediately (issue #48): deleting this device's own selection
		// must not leave it pointing at a caregiver that no longer exists.
		deviceCaregiverId = reconcileStoredCaregiverId(data.caregivers);
	}

	let editingCaregiverId = $state<string | null>(null);
	let editCaregiverName = $state('');
	let editCaregiverColor = $state('');

	function startEditCaregiver(cg: { id: string; name: string; color: string }) {
		editingCaregiverId = cg.id;
		editCaregiverName = cg.name;
		editCaregiverColor = cg.color;
		caregiverError = null;
		caregiverErrorSource = null;
	}

	function cancelEditCaregiver() {
		editingCaregiverId = null;
	}

	async function saveCaregiver(event: SubmitEvent, id: string) {
		event.preventDefault();
		caregiverError = null;
		caregiverErrorSource = null;
		const { ok, value } = await postJson(`/api/caregivers/${id}`, 'PATCH', {
			name: editCaregiverName,
			color: editCaregiverColor
		});
		if (!ok) {
			caregiverError = errorMessage(value);
			caregiverErrorSource = 'edit';
			caregiverErrorNonce++;
			return;
		}
		editingCaregiverId = null;
		caregiverStatus = `Aidant ${editCaregiverName} mis à jour.`;
		caregiverStatusNonce++;
		await invalidateAll();
	}

	// --- Cet appareil ---
	// Reconciled against the authoritative list on load (issue #48): a
	// caregiver deleted here or on another device must not linger as this
	// device's selection.
	let deviceCaregiverId = $state(reconcileStoredCaregiverId(data.caregivers));

	function selectDeviceCaregiver(id: string) {
		deviceCaregiverId = id;
		setStoredCaregiverId(id);
	}

	// --- Unité ---
	// Sourced from data.household (authoritative, refreshed by invalidateAll —
	// including after a restore) with a local override applied only while a
	// save of our own is in flight; deriving instead of copying data.household
	// into a separately-initialized $state avoids the
	// `state_referenced_locally` trap where that copy would never notice a
	// later authoritative change (issue #49).
	let volumeUnitOverride = $state<'ml' | 'oz' | null>(null);
	let volumeUnit = $derived(volumeUnitOverride ?? data.household.volumeUnit);
	let volumeUnitError = $state<string | null>(null);
	let volumeUnitPending = $state(false);
	// sr-only confirmation (the visual feedback is the pressed-button styling)
	// so a successful unit change is still announced (issue #52).
	let volumeUnitStatus = $state<string | null>(null);
	let volumeUnitErrorNonce = $state(0);
	let volumeUnitStatusNonce = $state(0);

	async function setVolumeUnit(unit: 'ml' | 'oz') {
		volumeUnitError = null;
		// Applied immediately for instant feedback (design-system.md § Mouvement);
		// dropped below if the save turns out to have failed, instead of
		// presenting an unsaved change as persistent — the control then reverts
		// to the untouched authoritative value. On success it is kept until
		// invalidateAll has refreshed data.household to match, so it never
		// flickers back to the pre-save value in between. Both buttons are
		// disabled meanwhile so a second click can't start a concurrent save
		// whose rollback would race this one's.
		volumeUnitOverride = unit;
		volumeUnitPending = true;

		const { ok, value } = await postJson('/api/household', 'PATCH', { volumeUnit: unit });
		if (!ok) {
			volumeUnitOverride = null;
			volumeUnitPending = false;
			volumeUnitError = errorMessage(value);
			volumeUnitErrorNonce++;
			return;
		}
		volumeUnitStatus = `Unité mise à jour : ${unit}.`;
		volumeUnitStatusNonce++;
		// invalidateAll also refreshes the layout data every other screen reads
		// its volume unit from (#44), so a change here reaches Today and History
		// without a reload.
		await invalidateAll();
		volumeUnitOverride = null;
		volumeUnitPending = false;
	}

	// --- Thème ---
	// Same override-over-authoritative-derivation pattern as volumeUnit above.
	let themeOverride = $state<'light' | 'dark' | 'auto' | null>(null);
	let theme = $derived(themeOverride ?? data.household.theme);
	let themeError = $state<string | null>(null);
	// sr-only confirmation (the visual feedback is the pressed-button styling
	// plus the document's own class/color change) so a successful theme change
	// is still announced (issue #52).
	let themeStatus = $state<string | null>(null);
	let themeErrorNonce = $state(0);
	let themeStatusNonce = $state(0);

	const THEME_LABELS: Record<'light' | 'dark' | 'auto', string> = {
		light: 'Clair',
		dark: 'Sombre',
		auto: 'Auto'
	};

	function applyTheme(t: 'light' | 'dark' | 'auto') {
		const dark =
			t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
		document.documentElement.classList.toggle('dark', dark);
		applyForcedThemeColor(t);
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
		themeOverride = t;

		const { ok, value } = await postJson('/api/household', 'PATCH', { theme: t });
		if (!ok) {
			themeOverride = null;
			applyTheme(previousTheme);
			if (previousStoredTheme === null) localStorage.removeItem('swaddle.theme');
			else localStorage.setItem('swaddle.theme', previousStoredTheme);
			themeError = errorMessage(value);
			themeErrorNonce++;
			return;
		}
		themeStatus = `Thème mis à jour : ${THEME_LABELS[t]}.`;
		themeStatusNonce++;
		// Kept until invalidateAll refreshes data.household.theme to match, for
		// the same no-flicker reason as volumeUnit above.
		await invalidateAll();
		themeOverride = null;
	}

	// --- Code PIN ---
	// Same override-over-authoritative-derivation pattern as volumeUnit above.
	let pinEnabledOverride = $state<boolean | null>(null);
	let pinEnabled = $derived(pinEnabledOverride ?? data.household.pinEnabled);
	let newPin = $state('');
	let newPinConfirm = $state('');
	let currentPin = $state('');
	let pinError = $state<string | null>(null);
	let pinMessage = $state<string | null>(null);
	let pinErrorNonce = $state(0);
	let pinMessageNonce = $state(0);

	async function enablePin(event: SubmitEvent) {
		event.preventDefault();
		pinError = null;
		pinMessage = null;
		if (newPin !== newPinConfirm) {
			pinError = 'Les deux codes ne correspondent pas.';
			pinErrorNonce++;
			return;
		}
		const { ok, value } = await postJson('/api/household/pin', 'PUT', {
			pin: newPin,
			currentPin: currentPin || undefined
		});
		if (!ok) {
			pinError = errorMessage(value);
			pinErrorNonce++;
			return;
		}
		pinEnabledOverride = true;
		newPin = '';
		newPinConfirm = '';
		currentPin = '';
		pinMessage = 'Code PIN mis à jour.';
		pinMessageNonce++;
		// Kept until invalidateAll refreshes data.household.pinEnabled to match,
		// for the same no-flicker reason as volumeUnit above.
		await invalidateAll();
		pinEnabledOverride = null;
	}

	async function disablePin(event: SubmitEvent) {
		event.preventDefault();
		pinError = null;
		pinMessage = null;
		const { ok, value } = await postJson('/api/household/pin', 'DELETE', { currentPin });
		if (!ok) {
			pinError = errorMessage(value);
			pinErrorNonce++;
			return;
		}
		pinEnabledOverride = false;
		currentPin = '';
		pinMessage = 'Code PIN désactivé.';
		pinMessageNonce++;
		// Kept until invalidateAll refreshes data.household.pinEnabled to match,
		// for the same no-flicker reason as volumeUnit above.
		await invalidateAll();
		pinEnabledOverride = null;
	}

	// --- Accès API (#97) ---
	let newTokenName = $state('');
	let newTokenCaregiverId = $state('');
	// The plaintext of the token just created. Held in memory only, for this
	// one render: the server stores a hash, so once this is cleared the token
	// can never be shown again — hence the copy button and the warning.
	let newTokenPlaintext = $state<string | null>(null);
	let tokenError = $state<string | null>(null);
	let tokenStatus = $state<string | null>(null);
	let tokenPending = $state(false);
	let tokenCopied = $state(false);
	let tokenErrorNonce = $state(0);
	let tokenStatusNonce = $state(0);

	function tokenLastUsedLabel(at: string | null): string {
		if (at === null) return 'jamais utilisé';
		// Stored at day granularity (apiTokens.ts), so only the date is shown.
		return `utilisé le ${new Date(at).toLocaleDateString('fr-CA', { dateStyle: 'medium' })}`;
	}

	async function createToken(event: SubmitEvent) {
		event.preventDefault();
		tokenError = null;
		tokenStatus = null;
		newTokenPlaintext = null;
		tokenCopied = false;
		tokenPending = true;
		const createdName = newTokenName;
		const { ok, value } = await postJson('/api/tokens', 'POST', {
			name: createdName,
			caregiverId: newTokenCaregiverId === '' ? null : newTokenCaregiverId
		});
		tokenPending = false;
		if (!ok) {
			tokenError = errorMessage(value);
			tokenErrorNonce++;
			return;
		}
		newTokenPlaintext = value.plaintext;
		newTokenName = '';
		newTokenCaregiverId = '';
		tokenStatus = `Jeton ${createdName} créé.`;
		tokenStatusNonce++;
		await invalidateAll();
	}

	async function copyToken() {
		if (newTokenPlaintext === null) return;
		try {
			await navigator.clipboard.writeText(newTokenPlaintext);
			tokenCopied = true;
		} catch {
			// Clipboard access can be refused (permissions, insecure context):
			// the token stays selectable on screen, so this is not an error.
			tokenCopied = false;
		}
	}

	async function revokeToken(id: string, name: string) {
		if (!confirm(`Révoquer le jeton « ${name} » ? L’appareil qui l’utilise perdra l’accès immédiatement.`))
			return;
		tokenError = null;
		tokenStatus = null;
		const { ok, value } = await postJson(`/api/tokens/${id}`, 'DELETE');
		if (!ok) {
			tokenError = errorMessage(value);
			tokenErrorNonce++;
			return;
		}
		tokenStatus = `Jeton ${name} révoqué.`;
		tokenStatusNonce++;
		await invalidateAll();
	}

	// --- Données ---
	let restoreMessage = $state<string | null>(null);
	let restoreError = $state<string | null>(null);
	let restoreInput: HTMLInputElement | null = null;
	let restoreMessageNonce = $state(0);
	let restoreErrorNonce = $state(0);

	async function restoreFile(event: Event) {
		restoreMessage = null;
		restoreError = null;
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		// Checked before the file is read: a payload the server would reject with
		// 413 shouldn't be loaded into memory and parsed first (issue #45), and
		// nothing about the current data changes.
		if (file.size > MAX_BODY_BYTES) {
			restoreError = userMessage('payload_too_large');
			restoreErrorNonce++;
			input.value = '';
			return;
		}
		const text = await file.text();
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			restoreError = 'Fichier JSON invalide.';
			restoreErrorNonce++;
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
			restoreErrorNonce++;
			return;
		}
		const { babies, caregivers, events } = value.restored;
		restoreMessage = `Restauré : ${babies} bébé(s), ${caregivers} aidant(s), ${events} événement(s).`;
		restoreMessageNonce++;
		await invalidateAll();
		// Unité and PIN above derive straight from data.household, refreshed by
		// invalidateAll — the theme also needs applying to the document (dark
		// class, forced theme-color meta) and to the persisted FOUC-avoidance
		// choice read by app.html, which a data refresh alone doesn't do (#49,
		// same applyTheme path as a manual theme change uses).
		applyTheme(data.household.theme);
		localStorage.setItem('swaddle.theme', data.household.theme);
	}

	// --- Sauvegarde ---
	// Fetched (not a plain download link) so the freshly written snapshot can
	// refresh « Dernière sauvegarde » via invalidateAll once the response lands.
	let backupPending = $state(false);
	let backupError = $state<string | null>(null);
	// sr-only confirmation (the visual feedback is the download itself, plus
	// the refreshed « Dernière sauvegarde » timestamp) so a successful backup
	// is still announced (issue #52).
	let backupStatus = $state<string | null>(null);
	let backupErrorNonce = $state(0);
	let backupStatusNonce = $state(0);

	async function downloadBackup() {
		if (backupPending) return;
		backupPending = true;
		backupError = null;
		try {
			const res = await fetch('/api/backup');
			if (!res.ok) {
				backupError = 'Une erreur est survenue.';
				backupErrorNonce++;
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
			backupStatus = 'Sauvegarde téléchargée.';
			backupStatusNonce++;
			await invalidateAll();
		} catch {
			backupError = 'Une erreur est survenue.';
			backupErrorNonce++;
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

<svelte:head>
	<title>{pageTitle('Réglages')}</title>
</svelte:head>

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
					<div class="flex flex-col gap-2 py-2">
						{#if editingBabyId === baby.id}
							<form class="flex flex-col gap-2" onsubmit={(e) => saveBaby(e, baby.id)}>
								<Label for={`edit-baby-name-${baby.id}`}>Prénom</Label>
								<Input
									id={`edit-baby-name-${baby.id}`}
									class="min-h-12 text-base"
									bind:value={editBabyName}
									required
									maxlength={100}
									aria-invalid={babyError !== null}
									aria-describedby={babyError !== null ? `baby-error-${baby.id}` : undefined}
								/>
								<Label for={`edit-baby-birthdate-${baby.id}`}>Date de naissance</Label>
								<Input
									id={`edit-baby-birthdate-${baby.id}`}
									type="date"
									class="min-h-12 text-base"
									bind:value={editBabyBirthdate}
									required
									aria-invalid={babyError !== null}
									aria-describedby={babyError !== null ? `baby-error-${baby.id}` : undefined}
								/>
								<LiveMessage
									id={`baby-error-${baby.id}`}
									text={babyError}
									kind="alert"
									nonce={babyErrorNonce}
									class="text-danger text-sm"
								/>
								<div class="flex gap-2">
									<Button type="submit" class="min-h-12" disabled={babyPending}
										>{babyPending ? 'Enregistrement…' : 'Enregistrer'}</Button
									>
									<Button type="button" variant="outline" class="min-h-12" onclick={cancelEditBaby}
										>Annuler</Button
									>
								</div>
							</form>
						{:else}
							<div class="flex items-baseline justify-between gap-4">
								<span class="text-label text-ink-label">Bébé</span>
								<span class="text-value text-ink tabular-nums">{baby.name} · {baby.birthdate}</span>
								<Button
									variant="outline"
									class="min-h-12"
									aria-label={`Modifier ${baby.name}`}
									onclick={() => startEditBaby(baby)}>Modifier</Button
								>
							</div>
							<LiveMessage
								text={babySuccessId === baby.id ? 'Profil du bébé mis à jour.' : null}
								kind="status"
								nonce={babySuccessNonce}
								class="text-ink-muted text-sm"
							/>
						{/if}
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
							aria-describedby={volumeUnitError !== null ? 'volume-unit-error' : undefined}
							onclick={() => setVolumeUnit('ml')}>ml</Button
						>
						<Button
							type="button"
							class="min-h-12 flex-1"
							disabled={volumeUnitPending}
							variant={volumeUnit === 'oz' ? 'default' : 'outline'}
							aria-describedby={volumeUnitError !== null ? 'volume-unit-error' : undefined}
							onclick={() => setVolumeUnit('oz')}>oz</Button
						>
					</div>
					<LiveMessage
						id="volume-unit-error"
						text={volumeUnitError}
						kind="alert"
						nonce={volumeUnitErrorNonce}
						class="text-danger text-sm"
					/>
					<LiveMessage text={volumeUnitStatus} kind="status" nonce={volumeUnitStatusNonce} class="sr-only" />
				</div>

				<div class="flex flex-col gap-2 py-2">
					<span class="text-label text-ink-label">Thème</span>
					<div class="flex gap-2">
						<Button
							type="button"
							class="min-h-12 flex-1"
							variant={theme === 'light' ? 'default' : 'outline'}
							aria-describedby={themeError !== null ? 'theme-error' : undefined}
							onclick={() => setTheme('light')}>Clair</Button
						>
						<Button
							type="button"
							class="min-h-12 flex-1"
							variant={theme === 'dark' ? 'default' : 'outline'}
							aria-describedby={themeError !== null ? 'theme-error' : undefined}
							onclick={() => setTheme('dark')}>Sombre</Button
						>
						<Button
							type="button"
							class="min-h-12 flex-1"
							variant={theme === 'auto' ? 'default' : 'outline'}
							aria-describedby={themeError !== null ? 'theme-error' : undefined}
							onclick={() => setTheme('auto')}>Auto</Button
						>
					</div>
					<LiveMessage
						id="theme-error"
						text={themeError}
						kind="alert"
						nonce={themeErrorNonce}
						class="text-danger text-sm"
					/>
					<LiveMessage text={themeStatus} kind="status" nonce={themeStatusNonce} class="sr-only" />
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
									aria-invalid={caregiverErrorSource === 'edit'}
									aria-describedby={caregiverErrorSource === 'edit' ? 'caregiver-error' : undefined}
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
							<!-- flex-wrap + a shrinkable name: at the 320 px floor the row's
							     fixed parts (colour dot, Modifier, Supprimer) need more width
							     than the card offers, and an unshrinkable `flex-1` name pushed
							     Supprimer ~3 px past the viewport — a horizontal scrollbar and a
							     partly off-screen control (WCAG 1.4.10). Wider viewports keep the
							     single-line layout unchanged. -->
							<div class="flex flex-wrap items-center gap-3">
								<span class="size-3 shrink-0" style:background-color={cg.color}></span>
								<span class="text-value text-ink min-w-0 flex-1 truncate">{cg.name}</span>
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
									onclick={() => deleteCaregiver(cg.id, cg.name)}>Supprimer</Button
								>
							</div>
						{/if}
					</li>
				{/each}
			</ul>

			<form class="border-border-hair flex flex-col gap-2 border-t pt-3" onsubmit={addCaregiver}>
				<Label for="new-caregiver-name">Nom de l’aidant</Label>
				<Input
					id="new-caregiver-name"
					class="min-h-12 text-base"
					bind:value={newCaregiverName}
					required
					aria-invalid={caregiverErrorSource === 'add'}
					aria-describedby={caregiverErrorSource === 'add' ? 'caregiver-error' : undefined}
				/>
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
				<LiveMessage
					id="caregiver-error"
					text={caregiverError}
					kind="alert"
					nonce={caregiverErrorNonce}
					class="text-danger text-sm"
				/>
				<LiveMessage text={caregiverStatus} kind="status" nonce={caregiverStatusNonce} class="sr-only" />
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
						aria-invalid={pinError !== null}
						aria-describedby={pinError !== null ? 'pin-error' : undefined}
					/>
					<Label for="new-pin">Nouveau code (4 à 8 chiffres)</Label>
					<Input
						id="new-pin"
						type="password"
						inputmode="numeric"
						class="min-h-12 text-base"
						bind:value={newPin}
						required
						aria-invalid={pinError !== null}
						aria-describedby={pinError !== null ? 'pin-error' : undefined}
					/>
					<Label for="new-pin-confirm">Confirmer le nouveau code</Label>
					<Input
						id="new-pin-confirm"
						type="password"
						inputmode="numeric"
						class="min-h-12 text-base"
						bind:value={newPinConfirm}
						required
						aria-invalid={pinError !== null}
						aria-describedby={pinError !== null ? 'pin-error' : undefined}
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
						aria-invalid={pinError !== null}
						aria-describedby={pinError !== null ? 'pin-error' : undefined}
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
						aria-invalid={pinError !== null}
						aria-describedby={pinError !== null ? 'pin-error' : undefined}
					/>
					<Label for="new-pin-confirm">Confirmer le code</Label>
					<Input
						id="new-pin-confirm"
						type="password"
						inputmode="numeric"
						class="min-h-12 text-base"
						bind:value={newPinConfirm}
						required
						aria-invalid={pinError !== null}
						aria-describedby={pinError !== null ? 'pin-error' : undefined}
					/>
					<Button type="submit" class="min-h-12">Activer le code PIN</Button>
				</form>
			{/if}
			<LiveMessage id="pin-error" text={pinError} kind="alert" nonce={pinErrorNonce} class="text-danger text-sm" />
			<LiveMessage
				id="pin-message"
				text={pinMessage}
				kind="status"
				nonce={pinMessageNonce}
				class="text-ink-muted text-sm"
			/>
		</section>

		<section class="flex flex-col gap-3 p-4">
			<h2 class="text-section text-ink-muted uppercase">Accès API</h2>
			<p class="text-ink-muted text-body">
				Un jeton laisse un appareil ou un raccourci enregistrer des activités sans ouvrir
				l’application. Il ne donne jamais accès aux écrans.
			</p>

			<ul class="divide-border-hair flex flex-col divide-y">
				{#each data.apiTokens as tk (tk.id)}
					{@const caregiver = data.caregivers.find((c) => c.id === tk.caregiverId)}
					<li class="flex flex-wrap items-center gap-3 py-2">
						<span class="min-w-0 flex-1">
							<span class="text-value text-ink block truncate"
								>{tk.name}{tk.revokedAt !== null ? ' · révoqué' : ''}</span
							>
							<span class="text-ink-muted block text-sm"
								>{caregiver ? caregiver.name : 'Aucun aidant'} · {tokenLastUsedLabel(tk.lastUsedAt)}</span
							>
						</span>
						{#if tk.revokedAt === null}
							<Button
								variant="ghost"
								class="text-danger min-h-12"
								aria-label={`Révoquer ${tk.name}`}
								onclick={() => revokeToken(tk.id, tk.name)}>Révoquer</Button
							>
						{/if}
					</li>
				{:else}
					<li class="text-ink-muted py-2">Aucun jeton.</li>
				{/each}
			</ul>

			{#if newTokenPlaintext !== null}
				<!-- Shown once and never again: only a hash is stored server-side. -->
				<div class="border-border bg-surface flex flex-col gap-2 border-2 p-3">
					<p class="text-ink text-body">
						Copiez ce jeton maintenant : il ne sera plus affiché.
					</p>
					<code class="text-ink bg-surface-raised border-border-hair border p-2 break-all select-all"
						>{newTokenPlaintext}</code
					>
					<Button type="button" variant="outline" class="min-h-12" onclick={copyToken}
						>{tokenCopied ? 'Copié' : 'Copier le jeton'}</Button
					>
				</div>
			{/if}

			<form class="border-border-hair flex flex-col gap-2 border-t pt-3" onsubmit={createToken}>
				<Label for="new-token-name">Nom du jeton</Label>
				<Input
					id="new-token-name"
					class="min-h-12 text-base"
					placeholder="iPhone Émile"
					bind:value={newTokenName}
					required
					maxlength={100}
					aria-invalid={tokenError !== null}
					aria-describedby={tokenError !== null ? 'token-error' : undefined}
				/>
				<Label for="new-token-caregiver">Aidant lié (facultatif)</Label>
				<select
					id="new-token-caregiver"
					class="border-border bg-surface text-ink min-h-12 border-2 px-2 text-base"
					bind:value={newTokenCaregiverId}
				>
					<option value="">Aucun</option>
					{#each data.caregivers as cg (cg.id)}
						<option value={cg.id}>{cg.name}</option>
					{/each}
				</select>
				<LiveMessage
					id="token-error"
					text={tokenError}
					kind="alert"
					nonce={tokenErrorNonce}
					class="text-danger text-sm"
				/>
				<LiveMessage text={tokenStatus} kind="status" nonce={tokenStatusNonce} class="sr-only" />
				<Button type="submit" class="min-h-12" disabled={tokenPending}
					>{tokenPending ? 'Création…' : 'Créer un jeton'}</Button
				>
			</form>
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
					aria-describedby={backupError !== null ? 'backup-error' : undefined}
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
					aria-describedby={restoreError !== null ? 'restore-error' : undefined}
					onclick={() => restoreInput?.click()}>Restaurer depuis un fichier…</Button
				>
			</div>
			<LiveMessage
				id="backup-error"
				text={backupError}
				kind="alert"
				nonce={backupErrorNonce}
				class="text-danger text-sm"
			/>
			<LiveMessage text={backupStatus} kind="status" nonce={backupStatusNonce} class="sr-only" />
			<LiveMessage
				id="restore-error"
				text={restoreError}
				kind="alert"
				nonce={restoreErrorNonce}
				class="text-danger text-sm"
			/>
			<LiveMessage
				text={restoreMessage}
				kind="status"
				nonce={restoreMessageNonce}
				class="text-ink-muted text-sm"
			/>
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
