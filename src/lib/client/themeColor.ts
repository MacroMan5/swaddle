import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from '$lib/meta';

// Marks the meta element this module owns, so it can find and replace its
// own override without touching the two `media`-conditioned metas declared
// in +layout.svelte (those track the OS preference for the 'auto' choice).
const FORCED_ATTR = 'data-forced-theme-color';

/**
 * Keeps the active `<meta name="theme-color">` in sync with an explicit
 * light/dark choice. The `media="(prefers-color-scheme: ...)"` pair in
 * +layout.svelte only ever tracks the OS preference, so a user who forces
 * the opposite theme would otherwise see the wrong browser-chrome color —
 * including right after changing the setting.
 *
 * When `forced` is 'dark' or 'light', an unconditioned override meta (no
 * `media` attribute, so it always matches) is inserted as the first element
 * of `<head>`: browsers pick the first matching `theme-color` meta in
 * document order, so this always wins over the conditioned pair regardless
 * of where SvelteKit's own `<svelte:head>` output lands. When `forced` is
 * 'auto', any previous override is removed so the conditioned pair takes
 * over again.
 */
export function applyForcedThemeColor(forced: 'light' | 'dark' | 'auto'): void {
	const existing = document.head.querySelector(`meta[name="theme-color"][${FORCED_ATTR}]`);
	if (forced === 'auto') {
		existing?.remove();
		return;
	}

	const content = forced === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
	if (existing) {
		existing.setAttribute('content', content);
		return;
	}

	const meta = document.createElement('meta');
	meta.setAttribute('name', 'theme-color');
	meta.setAttribute('content', content);
	meta.setAttribute(FORCED_ATTR, '');
	document.head.insertBefore(meta, document.head.firstChild);
}
