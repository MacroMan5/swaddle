import { createServer } from 'node:http';
import { handler } from './build/handler.js';

/**
 * Production entrypoint (issue #55).
 *
 * `node build` serves the static assets — `/_app/immutable/`, `static/` —
 * from adapter-node's own middleware, ahead of SvelteKit, so the `handle`
 * hook never sees those responses. This entrypoint sets the same-origin
 * headers on every response first, then delegates to the built handler, which
 * keeps the hook in charge of everything else (CSP, `cache-control`).
 *
 * Kept in sync with `src/lib/server/securityHeaders.ts` by
 * `securityHeaders.test.ts` — change one, change the other.
 */
const SECURITY_HEADERS = [
	['x-content-type-options', 'nosniff'],
	['referrer-policy', 'same-origin'],
	['x-frame-options', 'DENY'],
	['cross-origin-opener-policy', 'same-origin'],
	['cross-origin-resource-policy', 'same-origin']
];

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const SHUTDOWN_TIMEOUT_MS = 30_000;

const server = createServer((req, res) => {
	// Set before delegating: the handler may overwrite a header with its own
	// value, but nothing it serves can end up without them.
	for (const [name, value] of SECURITY_HEADERS) res.setHeader(name, value);

	handler(req, res, () => {
		res.statusCode = 404;
		res.end('Not found');
	});
});

server.listen({ host, port }, () => console.log(`Listening on http://${host}:${port}`));

/** SSE connections stay open, so idle sockets must be closed explicitly. */
function shutdown() {
	server.closeIdleConnections();
	server.close(() => process.exit(0));
	setTimeout(() => server.closeAllConnections(), SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
