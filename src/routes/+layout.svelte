<script lang="ts">
	import { onDestroy, setContext } from 'svelte';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import ConnectionBanner from '$lib/components/ConnectionBanner.svelte';
	import { SyncStore } from '$lib/client/sync.svelte';
	import { APP_DESCRIPTION, THEME_COLOR_DARK, THEME_COLOR_LIGHT } from '$lib/meta';

	let { children } = $props();

	// Owned here (not in +page.svelte) so the banner, which lives in the shell,
	// can read connection state; the Today page still drives start()/stop().
	const store = new SyncStore();
	setContext('sync', store);

	onDestroy(() => store.stop());
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<meta name="description" content={APP_DESCRIPTION} />
	<meta name="theme-color" media="(prefers-color-scheme: light)" content={THEME_COLOR_LIGHT} />
	<meta name="theme-color" media="(prefers-color-scheme: dark)" content={THEME_COLOR_DARK} />
</svelte:head>

<ConnectionBanner visible={store.connectionState === 'disconnected'} />

<div class="bg-surface text-ink flex min-h-dvh flex-col">
	<main class="mx-auto w-full max-w-2xl flex-1 pb-24">
		{@render children()}
	</main>
	<BottomNav />
</div>
