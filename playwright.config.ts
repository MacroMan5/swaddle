import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	globalSetup: './e2e/global-setup.ts',
	workers: 1,
	webServer: [
		{
			command: 'npm run build && node build',
			port: 3000,
			env: { DATA_DIR: '.playwright-data' },
			reuseExistingServer: false
		},
		{
			// Reuses the build produced by the first server; starts on an empty
			// data dir so the onboarding wizard (AC-008) sees a fresh install.
			command: 'node build',
			port: 3001,
			env: { DATA_DIR: '.playwright-data-empty', PORT: '3001' },
			reuseExistingServer: false
		}
	],
	use: { baseURL: 'http://localhost:3000' }
});
