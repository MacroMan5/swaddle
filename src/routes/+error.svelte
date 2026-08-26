<script lang="ts">
	import { page } from '$app/state';
	import { pageTitle } from '$lib/meta';

	const message = $derived(page.status === 404 ? 'Page introuvable' : 'Une erreur est survenue');
</script>

<svelte:head>
	<title>{pageTitle('Erreur')}</title>
</svelte:head>

<div class="bg-surface flex min-h-dvh flex-col items-center justify-center gap-3 p-4 text-center">
	<span class="text-brand text-ink uppercase">Swaddle</span>
	<h1 class="text-onboarding-title text-ink">{page.status}</h1>
	<p class="text-body text-ink-muted">{message}</p>
	<a
		href="/"
		class="bg-primary text-on-primary active:bg-primary-pressed mt-2 min-h-12 rounded-control px-4 py-2 font-semibold active:translate-y-px motion-reduce:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
	>
		Retour à l'accueil
	</a>
</div>
