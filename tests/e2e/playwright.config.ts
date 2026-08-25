import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: '.',
	globalSetup: './global-setup.ts',
	workers: 1,
	webServer: [
		{
			command: 'npm run build && node build',
			cwd: '../..',
			port: 3000,
			env: { DATA_DIR: '.playwright-data' },
			reuseExistingServer: false
		},
		{
			// Reuses the build produced by the first server; starts on an empty
			// data dir so the onboarding wizard (AC-008) sees a fresh install.
			command: 'node build',
			cwd: '../..',
			port: 3001,
			env: { DATA_DIR: '.playwright-data-empty', PORT: '3001' },
			reuseExistingServer: false
		}
	],
	// reducedMotion keeps the Registre entrance/pulse animations out of e2e
	// timing — specs assert layout and behavior, not motion.
	use: { baseURL: 'http://localhost:3000', reducedMotion: 'reduce' }
});
