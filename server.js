import { createServer } from 'node:http';

/**
 * Largest request body the adapter accepts — mirrors `MAX_BODY_BYTES` in
 * `src/lib/limits.ts` (issue #45): a household's JSON export grows with years
 * of events, and adapter-node's 512 KiB default rejects a valid one. The
 * adapter reads `BODY_SIZE_LIMIT` when `build/handler.js` is first evaluated,
 * so the default has to be in place before that import runs — hence the
 * dynamic import below. An explicit env (Dockerfile, compose) still wins.
 */
process.env.BODY_SIZE_LIMIT ??= '10M';

const { handler } = await import('./build/handler.js');

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
