<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { pageTitle } from '$lib/meta';
	import {
		CONSOLE_ENDPOINTS,
		DEFAULT_ENDPOINT_ID,
		type ConsoleEndpoint
	} from '$lib/client/console/catalog';

	// The console fires the request exactly as written — no client-side
	// validation, no ApiError mapping: seeing the raw envelope (status, issues,
	// speech) is the whole point (issue 115).

	const groups = [...new Set(CONSOLE_ENDPOINTS.map((e) => e.group))];
	const byId = new Map(CONSOLE_ENDPOINTS.map((e) => [e.id, e]));

	// The `__now__` placeholder resolves when the entry is picked, not at
	// module evaluation: under SSR the catalog is evaluated once at boot, and a
	// boot-time `startedAt` on a long-running server would be a lie.
	const resolveBody = (endpoint: ConsoleEndpoint): string =>
		(endpoint.body ?? '').replaceAll('"__now__"', JSON.stringify(new Date().toISOString()));

	const defaultEndpoint = byId.get(DEFAULT_ENDPOINT_ID)!;
	let selectedId = $state(DEFAULT_ENDPOINT_ID);
	let selected = $derived(byId.get(selectedId)!);
	let path = $state(defaultEndpoint.path);
	let bodyText = $state(resolveBody(defaultEndpoint));
	let authMode = $state<'session' | 'token'>('session');
	let token = $state('');
	// Unchecked, the request leaves without `application/json`: fetch invents
	// text/plain for the body, and the skeleton's content-type gate refuses it
	// exactly like a shortcut whose header is missing or wrong — the failure
	// issue 115 was opened about, now reproducible from any engine.
	let sendJsonHeader = $state(true);
	let sending = $state(false);

	type ConsoleResult = {
		status: number;
		statusText: string;
		durationMs: number;
		body: string;
		ok: boolean;
	};
	let result = $state<ConsoleResult | null>(null);
	let transportError = $state<string | null>(null);

	function pick(endpoint: ConsoleEndpoint) {
		selectedId = endpoint.id;
		path = endpoint.path;
		bodyText = resolveBody(endpoint);
		sendJsonHeader = true;
		result = null;
		transportError = null;
	}

	function prettify(text: string, contentType: string | null): string {
		if (text === '') return '(corps vide)';
		if (contentType?.includes('application/json')) {
			try {
				return JSON.stringify(JSON.parse(text), null, 2);
			} catch {
				return text;
			}
		}
		return text;
	}

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (selected.danger && !confirm(`${selected.summary}\nEnvoyer quand même ?`)) return;
		transportError = null;
		result = null;
		if (!path.startsWith('/')) {
			// The CSP already blocks cross-origin fetches; this just keeps a typo
			// from sending the Bearer anywhere but this server.
			transportError = 'le chemin doit commencer par « / »';
			return;
		}
		sending = true;

		const hasBody = selected.method !== 'GET' && bodyText.trim() !== '';
		const headers: Record<string, string> = {};
		if (hasBody && sendJsonHeader) headers['content-type'] = 'application/json';
		if (authMode === 'token') headers['authorization'] = `Bearer ${token.trim()}`;

		const startedAt = performance.now();
		try {
			// `credentials: 'omit'` in token mode drops the PIN session cookie, so
			// the call authenticates exactly like a headless shortcut would.
			const res = await fetch(path, {
				method: selected.method,
				headers,
				body: hasBody ? bodyText : undefined,
				credentials: authMode === 'token' ? 'omit' : 'same-origin'
			});
			const text = await res.text();
			result = {
				status: res.status,
				statusText: res.statusText,
				durationMs: Math.round(performance.now() - startedAt),
				body: prettify(text, res.headers.get('content-type')),
				ok: res.ok
			};
		} catch (e) {
			transportError = e instanceof Error ? e.message : 'la requête a échoué';
		} finally {
			sending = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle('Console API')}</title>
</svelte:head>

<div class="mx-auto flex max-w-lg flex-col gap-4 p-4">
	<div class="border-border enter border-b-2 pb-3">
		<h1 class="text-screen-title text-ink">Console API</h1>
		<p class="text-ink-muted text-sm">
			Envoie une requête telle quelle et montre la réponse brute — le contrat vit dans
			<code>docs/api/</code>.
		</p>
	</div>

	<div class="bg-surface-raised border-border enter flex flex-col gap-4 border-2 p-4">
		<div class="flex flex-col gap-2">
			<Label for="console-endpoint">Endpoint</Label>
			<select
				id="console-endpoint"
				data-testid="console-endpoint"
				class="border-border bg-surface text-ink min-h-12 border-2 px-3 text-base"
				value={selectedId}
				onchange={(e) => pick(byId.get(e.currentTarget.value)!)}
			>
				{#each groups as group (group)}
					<optgroup label={group}>
						{#each CONSOLE_ENDPOINTS.filter((e) => e.group === group) as endpoint (endpoint.id)}
							<option value={endpoint.id}
							>{endpoint.method}
							{endpoint.path}{endpoint.label ? ` — ${endpoint.label}` : ''}</option
						>
						{/each}
					</optgroup>
				{/each}
			</select>
			<p class="text-ink-muted text-sm">
				{selected.summary}
				{#if selected.danger}<span class="text-danger"> Action destructrice.</span>{/if}
				{#if selected.pinOnly}<span> Session PIN seulement — un jeton est refusé ici.</span>{/if}
			</p>
			<p class="text-ink-muted text-sm">Contrat : <code>docs/api/{selected.doc}</code></p>
		</div>

		<form class="flex flex-col gap-4" onsubmit={send}>
			<div class="flex flex-col gap-2">
				<Label for="console-path">{selected.method} — chemin</Label>
				<Input
					id="console-path"
					data-testid="console-path"
					class="min-h-12 font-mono text-base"
					bind:value={path}
				/>
			</div>

			{#if selected.method !== 'GET'}
				<div class="flex flex-col gap-2">
					<Label for="console-body">Corps JSON</Label>
					<textarea
						id="console-body"
						data-testid="console-body"
						class="border-border bg-surface text-ink min-h-32 border-2 p-3 font-mono text-base"
						rows="6"
						bind:value={bodyText}
					></textarea>
					<label class="text-ink flex min-h-12 items-center gap-2 text-sm">
						<input
							type="checkbox"
							class="size-5"
							data-testid="console-json-header"
							bind:checked={sendJsonHeader}
						/>
						Envoyer <code>Content-Type: application/json</code> — décoché, la requête est
						refusée avant lecture du corps (<code>invalid_content_type</code>), comme un
						raccourci mal configuré
					</label>
				</div>
			{/if}

			<fieldset class="flex flex-col gap-2">
				<legend class="text-label text-ink-label pb-2">Authentification</legend>
				<div class="flex gap-2">
					<Button
						type="button"
						variant={authMode === 'session' ? 'default' : 'outline'}
						class="min-h-12 flex-1"
						aria-pressed={authMode === 'session'}
						onclick={() => (authMode = 'session')}
					>
						Session PIN
					</Button>
					<Button
						type="button"
						variant={authMode === 'token' ? 'default' : 'outline'}
						class="min-h-12 flex-1"
						aria-pressed={authMode === 'token'}
						data-testid="console-auth-token"
						onclick={() => (authMode = 'token')}
					>
						Jeton seul
					</Button>
				</div>
				{#if authMode === 'token'}
					<Label for="console-token" class="sr-only">Jeton Bearer</Label>
					<Input
						id="console-token"
						data-testid="console-token"
						class="min-h-12 font-mono text-base"
						placeholder="swd_…"
						autocomplete="off"
						bind:value={token}
					/>
					<p class="text-ink-muted text-sm">
						Envoyé sans cookie de session (<code>credentials: 'omit'</code>) : la requête
						s’authentifie exactement comme un raccourci.
					</p>
				{/if}
			</fieldset>

			<Button type="submit" class="min-h-12" disabled={sending} data-testid="console-send">
				{sending ? 'Envoi…' : 'Envoyer'}
			</Button>
		</form>

		{#if transportError}
			<p class="text-danger" role="alert" data-testid="console-transport-error">
				Requête impossible : {transportError}
			</p>
		{/if}

		<div aria-live="polite">
			{#if result}
				<div class="flex flex-col gap-2" data-testid="console-result">
					<p class="text-value text-ink tabular-nums">
						<span class={result.ok ? 'text-ink' : 'text-danger'} data-testid="console-status">
							{result.status} {result.statusText}
						</span>
						· {result.durationMs} ms
					</p>
					<pre
						class="border-border bg-surface text-ink overflow-x-auto border-2 p-3 font-mono text-sm whitespace-pre-wrap"
						data-testid="console-response">{result.body}</pre>
				</div>
			{/if}
		</div>
	</div>
</div>
