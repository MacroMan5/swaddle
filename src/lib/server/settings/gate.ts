import { isValidSession } from './auth';

// Exact matches only, except '/_app/' (SvelteKit's own static asset prefix).
// '/api/health' stays public on purpose: the Docker healthcheck and CI probe
// it without a session, and it leaks no data (see docs/api/settings-api.md).
const ALWAYS_OK_EXACT = new Set(['/api/health', '/favicon.ico']);
const ALWAYS_OK_PREFIX = '/_app/';

const SETUP_WIZARD_API_PATHS = ['/api/babies', '/api/caregivers', '/api/household'];

// Paths the PIN gate itself must let through even while locked, so the
// unlock flow is reachable: the page that lets you enter the code, and the
// endpoint that verifies it.
const PIN_GATE_EXEMPT = new Set(['/pin', '/api/auth/pin']);

// Token management is the one API surface a Bearer never reaches: a leaked
// token must not be able to mint successors for itself or revoke the parents'
// other devices. Creating and revoking tokens stays a PIN-session act, done
// from /settings on a device someone actually unlocked (issue #97).
const BEARER_FORBIDDEN_PREFIX = '/api/tokens';

export function gateDecision(opts: {
	pathname: string;
	setupComplete: boolean;
	pinHash: string | null;
	sessionCookie: string | undefined;
	/**
	 * Whether the request carried a valid `Authorization: Bearer` (ADR 0004).
	 * The verification itself — parsing, hashing, revocation — lives in
	 * `apiTokens.verifyBearer`, called by `hooks.server.ts`; the decision stays
	 * pure and only takes the answer.
	 */
	hasBearerAuth?: boolean;
}): 'ok' | 'to-setup' | 'to-pin' {
	const { pathname, setupComplete, pinHash, sessionCookie, hasBearerAuth = false } = opts;

	if (ALWAYS_OK_EXACT.has(pathname) || pathname.startsWith(ALWAYS_OK_PREFIX)) return 'ok';

	// The PIN gate is evaluated FIRST, ahead of the setup gate. Two reasons:
	// - otherwise an API call could slip through PIN protection whenever setup
	//   also happens to be incomplete (the setup gate never blocks /api/*);
	// - checking setup first would redirect-loop when both conditions hold
	//   (/setup -> to-pin -> /pin -> to-setup -> /setup -> ...), since /pin is
	//   not itself an setup-gate-exempt path.
	// Exempt paths return 'ok' immediately (not falling through to the setup
	// gate below) precisely to avoid that loop: the unlock page and endpoint
	// must always be reachable regardless of setup completeness.
	// A valid Bearer stands in for a PIN session, but only for /api/* and never
	// for token management: a token is a headless device's credential, not a way
	// to browse the app, so pages keep demanding the code.
	const bearerUnlocks =
		hasBearerAuth && pathname.startsWith('/api/') && !pathname.startsWith(BEARER_FORBIDDEN_PREFIX);

	if (pinHash !== null && !bearerUnlocks && !isValidSession(sessionCookie, pinHash)) {
		if (PIN_GATE_EXEMPT.has(pathname)) return 'ok';
		return 'to-pin';
	}

	if (!setupComplete) {
		const allowed = pathname === '/setup' || SETUP_WIZARD_API_PATHS.some((p) => pathname.startsWith(p));
		if (!allowed) return 'to-setup';
	}

	return 'ok';
}
