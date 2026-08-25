import { defineConfig } from '@playwright/test';

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
			command: 'node build',
			cwd: '../..',
			port: 3000,
			env: { DATA_DIR: '.playwright-data' },
			reuseExistingServer: false
		},
		{
			// Same prebuilt output; starts on an empty
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
