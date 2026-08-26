import { expect, test } from '@playwright/test';

// Guard for issue #87. The suite's timing assertions (toast expiry, row
// updates) assume the Registre entrance/pulse animations are off, which
// playwright.config.ts arranges once for every browser project. That
// arrangement is easy to break silently — `reducedMotion` at the top level of
// `use` is reported by `testInfo` but never reaches the page under Playwright
// 1.62 (microsoft/playwright#42001), which is exactly how it broke the first
// time. This spec fails loudly instead: it asks the page itself, not the
// config.
//
// No navigation target of its own beyond `/` and no writes, so it is safe
// wherever alphabetical file order places it, PIN gate or not.
test('the browser context really emulates prefers-reduced-motion (issue #87)', async ({ page }) => {
	await page.goto('/');

	const prefersReducedMotion = await page.evaluate(
		() => window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);

	expect(
		prefersReducedMotion,
		'the shared config must emulate reduced motion in the page, not just report it'
	).toBe(true);
});
