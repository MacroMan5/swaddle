import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	globalSetup: './e2e/global-setup.ts',
	workers: 1,
	webServer: {
		command: 'npm run build && node build',
		port: 3000,
		env: { DATA_DIR: '.playwright-data' },
		reuseExistingServer: false
	},
	use: { baseURL: 'http://localhost:3000' }
});
