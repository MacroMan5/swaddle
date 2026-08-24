<script lang="ts">
	import { page } from '$app/state';
	import { House, CalendarDays, Settings } from '@lucide/svelte';

	const items = [
		{ href: '/', label: 'Aujourd’hui', icon: House },
		{ href: '/history', label: 'Historique', icon: CalendarDays },
		{ href: '/settings', label: 'Réglages', icon: Settings }
	];

	function isActive(href: string): boolean {
		return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	}
</script>

<nav
	aria-label="Navigation principale"
	class="bg-surface-raised border-border fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)]"
>
	<ul class="mx-auto flex max-w-2xl">
		{#each items as item (item.href)}
			{@const active = isActive(item.href)}
			<li class="flex-1">
				<a
					href={item.href}
					aria-current={active ? 'page' : undefined}
					class="focus-visible:ring-primary relative flex min-h-12 flex-col items-center justify-center gap-1 px-2 py-2 text-base focus-visible:ring-2 focus-visible:outline-none {active
						? 'text-primary font-semibold'
						: 'text-ink-muted'}"
				>
					<!-- Active state is carried by an indicator bar too: colour is never the only signal. -->
					<span
						class="absolute top-0 h-0.5 w-10 rounded-full {active ? 'bg-primary' : 'bg-transparent'}"
					></span>
					<item.icon size={22} strokeWidth={2} aria-hidden="true" />
					<span>{item.label}</span>
				</a>
			</li>
		{/each}
	</ul>
</nav>
