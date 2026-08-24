<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import BottomNav from '$lib/components/BottomNav.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="bg-surface text-ink flex min-h-dvh flex-col">
	<main class="mx-auto w-full max-w-2xl flex-1 pb-24">
		{@render children()}
	</main>
	<BottomNav />
</div>
