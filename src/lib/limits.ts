/**
 * Largest request body the application accepts (issue #45).
 *
 * A restore payload is the only body that can grow with usage — years of
 * events export to a few MiB of JSON — and adapter-node's default cap is
 * 512 KiB, which reports a perfectly valid export as malformed. The bound is
 * declared in three places that cannot import each other and are kept in sync
 * by `src/lib/server/bodyLimit.test.ts`:
 *
 * - here, for the server guard (`src/lib/server/http.ts`) and the browser
 *   pre-check (`src/routes/settings/+page.svelte`);
 * - `BODY_SIZE_LIMIT` in `server.js`, the production entrypoint, so every
 *   deployment gets the same adapter bound even without env configuration;
 *   - and, explicitly, in `Dockerfile` / `deploy/docker-compose.yml` so an
 *     operator can see and change it.
 */
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** The same bound, as shown to the user (French UI). */
export const MAX_BODY_LABEL = '10 Mo';
