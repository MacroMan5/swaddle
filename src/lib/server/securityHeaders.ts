/**
 * Same-origin browser defenses applied to every response the app itself
 * produces (issue #55).
 *
 * The Content-Security-Policy is NOT here: it is configured in
 * `vite.config.ts` (`csp` of the SvelteKit plugin) so SvelteKit can mint a
 * per-request nonce, put it on its own hydration script and on the theme
 * bootstrap of `src/app.html` (`%sveltekit.nonce%`). CSP only ever lands on
 * HTML responses; the headers below must also reach JSON, SSE and downloads,
 * which is why they live in the `handle` hook instead.
 */
const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
	// No MIME sniffing: an export or a backup must be taken at its declared type.
	['x-content-type-options', 'nosniff'],
	// Referrer never leaves the origin (CSP frame-ancestors' legacy companion
	// for X-Frame-Options; both keep the app out of any frame).
	['referrer-policy', 'same-origin'],
	['x-frame-options', 'DENY'],
	['cross-origin-opener-policy', 'same-origin'],
	['cross-origin-resource-policy', 'same-origin']
];

/**
 * Everything served through the hook — pages and `/api/*` alike — carries
 * household data, so nothing is cacheable. Two things are deliberately left
 * alone:
 * - responses that already chose a policy (the SSE stream's `no-cache`);
 * - the immutable build assets under `/_app/immutable/`, which adapter-node
 *   serves from its static middleware, before `handle` ever runs, and which
 *   therefore keep their long-term caching.
 */
export function applySecurityHeaders(response: Response): Response {
	for (const [name, value] of SECURITY_HEADERS) response.headers.set(name, value);
	if (!response.headers.has('cache-control')) response.headers.set('cache-control', 'no-store');
	return response;
}
