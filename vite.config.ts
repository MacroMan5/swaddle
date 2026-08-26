import adapter from '@sveltejs/adapter-node';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: adapter(),

			// Same-origin CSP (issue #55). `nonce` mode, not `hash`: SvelteKit
			// only hashes the inline scripts it generates itself, so the theme
			// bootstrap of src/app.html would be blocked — a per-request nonce
			// reaches it through the %sveltekit.nonce% placeholder. Nothing is
			// prerendered, so nonces apply to every page.
			// 'unsafe-inline' is kept for styles only: SSR emits inline `style`
			// attributes (starting with app.html's own wrapper) and Svelte
			// transitions build inline <style> elements. Scripts stay strict.
			// The other security headers are set in src/hooks.server.ts, since
			// CSP only lands on HTML responses.
			csp: {
				mode: 'nonce',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:'],
					'font-src': ['self'],
					'connect-src': ['self'],
					'base-uri': ['self'],
					'form-action': ['self'],
					'frame-ancestors': ['none'],
					'object-src': ['none']
				}
			}
		})
	],
	test: {
		// tests/e2e/ holds Playwright specs (npm run test:e2e), not Vitest tests.
		exclude: ['tests/e2e/**', 'node_modules/**']
	}
});
