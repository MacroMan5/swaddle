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

		// Pipi/Caca/Les deux are measured directly: FR-001 wants them one touch
		// from the home screen, so the picker row is visible by default.
		for (const name of [
			'Pipi',
			'Caca',
			'Les deux',
			'Allaiter',
			'Biberon',
			'Couche',
			'Tirage',
			'Commencer le sommeil'
		]) {
			const box = await page.getByRole('button', { name, exact: true }).boundingBox();
			// Rounded: fractional line heights make layout subpixel, and a 48px
			// target can measure 47.999996 depending on its offset.
			expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(48);
		}
	});
}

test('dark mode is not pure white', async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => document.documentElement.classList.add('dark'));
	const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	expect(background).not.toBe('rgb(255, 255, 255)');
});

for (const width of WIDTHS) {
	test(`history: no horizontal scroll at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 800 });
		await page.goto('/history');
		await expect(page.getByRole('heading', { name: 'Historique' })).toBeVisible();

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth
		);
		expect(overflow).toBe(true);

		for (const name of ['Jour précédent', 'Jour suivant', 'Ajouter']) {
			const box = await page.getByRole('button', { name, exact: true }).boundingBox();
			// Rounded: fractional line heights make layout subpixel, and a 48px
			// target can measure 47.999996 depending on its offset.
			expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(48);
		}
	});
}

test('history: dark mode is not pure white', async ({ page }) => {
	await page.goto('/history');
	await page.evaluate(() => document.documentElement.classList.add('dark'));
	const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	expect(background).not.toBe('rgb(255, 255, 255)');
});
