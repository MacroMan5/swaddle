// Single source of truth for per-route <svelte:head> metadata (issue #51):
// each route builds its <title>/description from here so tab, bookmark, and
// device UI labels stay consistent and no third-party requests slip in.

export const APP_NAME = 'Swaddle';

export const APP_DESCRIPTION =
	"Suivi auto-hébergé des tétées, biberons, sommeil et couches d'un nouveau-né.";

// Matches --surface / .dark --surface in src/app.css, so the browser chrome
// (address bar, task switcher) stays on-token in both color schemes.
export const THEME_COLOR_LIGHT = '#faf9f7';
export const THEME_COLOR_DARK = '#16151a';

/** Builds a route's document title, e.g. `pageTitle('Aujourd’hui')` → `"Aujourd’hui — Swaddle"`. */
export function pageTitle(section: string): string {
	return `${section} — ${APP_NAME}`;
}
