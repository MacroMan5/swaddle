import { defineConfig, devices } from '@playwright/test';
import { BASE_A, BASE_B, PORT_A, PORT_B } from './ports';

// API-only specs (no `page`/`browser` fixture) hit server A over plain HTTP —
// running them once, in a browser-less "api" project, gives full coverage
// without paying for it twice under Chromium and under WebKit (issue #53).
const API_ONLY = /[\\/]api-.*\.spec\.ts$/;
const RESET_SERVERS = /[\\/]reset-servers\.setup\.ts$/;

export default defineConfig({
	testDir: '.',
	globalSetup: './global-setup.ts',
	workers: 1,
	webServer: [
		{
			// The production build is produced by the `test:e2e` npm script
			// before Playwright starts: both servers boot concurrently, so
			// building here would race the second server against the adapter
			// clearing `build/` mid-write.
			command: 'node server.js',
			cwd: '../..',
			port: PORT_A,
			// ORIGIN: adapter-node otherwise defaults the inferred origin's
			// protocol to https (see get_origin in its handler.js) whenever
			// PROTOCOL_HEADER isn't set, regardless of the actual connection —
			// so the PIN session cookie's `secure` flag (sessionCookieOptions in
			// src/lib/server/settings/auth.ts, which reads it off `url.protocol`
			// specifically to stay plain-HTTP-safe on a LAN) would always come
			// out `true` here. Chromium's "localhost is a secure context"
			// leniency hides that over plain HTTP; WebKit enforces the cookie
			// spec strictly and drops it, so pin.spec.ts's persistent-session
			// assertion only surfaced this once WebKit joined the suite.
			env: { DATA_DIR: '.playwright-data', PORT: String(PORT_A), ORIGIN: BASE_A },
			reuseExistingServer: false
		},
		{
			// Same prebuilt output; starts on an empty
			// data dir so the onboarding wizard (AC-008) sees a fresh install.
			command: 'node server.js',
			cwd: '../..',
			port: PORT_B,
			env: { DATA_DIR: '.playwright-data-empty', PORT: String(PORT_B), ORIGIN: BASE_B },
			reuseExistingServer: false
		}
	],
	// reducedMotion keeps the Registre entrance/pulse animations out of e2e
	// timing — specs assert layout and behavior, not motion.
	use: { baseURL: BASE_A, reducedMotion: 'reduce' },
	// Chromium and WebKit approximate the documented support matrix (Chrome
	// Android, Safari iOS) closely enough on desktop engines to be worth
	// running in CI; see docs/testing/real-device-checklist.md for the gaps
	// (touch, safe areas, VoiceOver/TalkBack) only a real device can cover.
	//
	// `chromium` and `webkit` both run the full browser-driven suite in
	// alphabetical file order, exactly as the single implicit project used
	// to — including the onboarding → pin ordering on server B that
	// pin.spec.ts's comment already calls out. Both servers are one shared
	// process for the whole run (the webServer list above starts them once),
	// so a second project replaying the same specs against already-mutated
	// servers would fail assumptions like AC-008's "empty db" on B, or
	// collide with literal test data chromium's run left on A (see
	// reset-servers.setup.ts). Rather than rely on run-order guarantees
	// across independent Playwright projects (undocumented and not worth
	// depending on), `dependencies` forces a strict chain — api → chromium →
	// reset-servers → webkit — so `reset-servers.setup.ts` always runs once,
	// after chromium's specs have finished and before webkit's start,
	// putting both servers back to the state global-setup.ts left them in.
	projects: [
		{
			name: 'api',
			testMatch: API_ONLY,
			use: { ...devices['Desktop Chrome'] }
		},
		{
			name: 'chromium',
			testIgnore: [API_ONLY, RESET_SERVERS],
			dependencies: ['api'],
			use: { ...devices['Desktop Chrome'] }
		},
		{
			name: 'reset-servers',
			testMatch: RESET_SERVERS,
			dependencies: ['chromium']
		},
		{
			name: 'webkit',
			testIgnore: [API_ONLY, RESET_SERVERS],
			dependencies: ['reset-servers'],
			use: { ...devices['Desktop Safari'] }
		}
	]
});
