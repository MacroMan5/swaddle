import { defineConfig } from '@playwright/test';
import { BASE_A, BASE_B, PORT_A, PORT_B } from './ports';

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
			// ORIGIN matches production (deploy/README.md, issue #69): without
			// it, adapter-node assumes https and the PIN session cookie is
			// marked Secure, which plain HTTP never delivers back — WebKit
			// enforces this strictly where Chromium's localhost leniency hides
			// it (see pin.spec.ts's Secure-cookie regression test).
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
	use: { baseURL: BASE_A, reducedMotion: 'reduce' }
});
