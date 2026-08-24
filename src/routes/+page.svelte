<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Baby } from '@lucide/svelte';
</script>

<h1 class="p-4 text-2xl font-bold text-ink">Swaddle</h1>
<p class="px-4 text-ink-muted">Suivi bébé auto-hébergé — en construction.</p>
<div class="m-4 flex gap-2">
	<span class="rounded-card bg-feed-100 px-3 py-2 text-feed-700">Alimentation</span>
	<span class="rounded-card bg-diaper-100 px-3 py-2 text-diaper-700">Couche</span>
	<span class="rounded-card bg-sleep-100 px-3 py-2 text-sleep-700">Sommeil</span>
</div>

<Card.Root class="m-4">
	<Card.Header>
		<Card.Title class="flex items-center gap-2"><Baby size={20} /> Swaddle</Card.Title>
	</Card.Header>
	<Card.Content>
		<Button>Bouton de test</Button>
	</Card.Content>
</Card.Root>
