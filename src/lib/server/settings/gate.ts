import { isValidSession } from './auth';

const ALWAYS_OK_PREFIXES = ['/api/auth/pin', '/api/health', '/_app/', '/favicon'];
const SETUP_WIZARD_API_PATHS = ['/api/babies', '/api/caregivers', '/api/household'];

export function gateDecision(opts: {
	pathname: string;
	setupComplete: boolean;
	pinHash: string | null;
	sessionCookie: string | undefined;
}): 'ok' | 'to-setup' | 'to-pin' {
	const { pathname, setupComplete, pinHash, sessionCookie } = opts;

	if (ALWAYS_OK_PREFIXES.some((p) => pathname.startsWith(p))) return 'ok';

	if (!setupComplete) {
		const allowed = pathname === '/setup' || SETUP_WIZARD_API_PATHS.some((p) => pathname.startsWith(p));
		if (!allowed) return 'to-setup';
	}

	if (pinHash !== null && !isValidSession(sessionCookie, pinHash) && pathname !== '/pin')
		return 'to-pin';

	return 'ok';
}
