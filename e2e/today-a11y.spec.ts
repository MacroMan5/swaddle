import { expect, test } from '@playwright/test';

const WIDTHS = [320, 390, 768];

for (const width of WIDTHS) {
	test(`no horizontal scroll and 48px touch targets at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 800 });
		await page.goto('/');

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth
		);
		expect(overflow).toBe(true);

		for (const name of ['Pipi', 'Caca', 'Les deux']) {
			const box = await page.getByRole('button', { name, exact: true }).boundingBox();
			expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
		}
	});
}

test('dark mode is not pure white', async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => document.documentElement.classList.add('dark'));
	const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	expect(background).not.toBe('rgb(255, 255, 255)');
});
