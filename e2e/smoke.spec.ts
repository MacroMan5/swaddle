import { expect, test } from '@playwright/test';

test('home page renders with tokens applied', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Swaddle' })).toBeVisible();
});

test('health endpoint reports seeded setup', async ({ request }) => {
	const res = await request.get('/api/health');
	expect(res.ok()).toBeTruthy();
	const body = await res.json();
	expect(body.status).toBe('ok');
	expect(body.setupComplete).toBe(true);
});
