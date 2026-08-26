import { describe, expect, it } from 'vitest';
import { createBabySchema, patchBabySchema } from './babySchema';

describe('createBabySchema', () => {
	it('accepts a valid name and birthdate', () => {
		const parsed = createBabySchema.safeParse({ name: 'Léa', birthdate: '2026-08-01' });
		expect(parsed.success).toBe(true);
	});

	it('rejects a blank name', () => {
		expect(createBabySchema.safeParse({ name: '', birthdate: '2026-08-01' }).success).toBe(false);
	});

	it('rejects a future birthdate', () => {
		const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		expect(createBabySchema.safeParse({ name: 'Léa', birthdate: future }).success).toBe(false);
	});

	it('rejects an impossible calendar date', () => {
		expect(createBabySchema.safeParse({ name: 'Léa', birthdate: '2024-02-30' }).success).toBe(false);
	});

	it('rejects a malformed birthdate', () => {
		expect(createBabySchema.safeParse({ name: 'Léa', birthdate: '08/01/2026' }).success).toBe(false);
		expect(createBabySchema.safeParse({ name: 'Léa', birthdate: 'not-a-date' }).success).toBe(false);
	});
});

describe('patchBabySchema (#46)', () => {
	it('accepts a partial patch with only the name', () => {
		expect(patchBabySchema.safeParse({ name: 'Léa-Rose' }).success).toBe(true);
	});

	it('accepts a partial patch with only the birthdate', () => {
		expect(patchBabySchema.safeParse({ birthdate: '2026-07-28' }).success).toBe(true);
	});

	it('accepts an empty patch', () => {
		expect(patchBabySchema.safeParse({}).success).toBe(true);
	});

	it('rejects a blank name', () => {
		expect(patchBabySchema.safeParse({ name: '' }).success).toBe(false);
	});

	it('rejects a future birthdate', () => {
		const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		expect(patchBabySchema.safeParse({ birthdate: future }).success).toBe(false);
	});

	it('rejects an impossible calendar date', () => {
		expect(patchBabySchema.safeParse({ birthdate: '2024-02-30' }).success).toBe(false);
	});

	it('rejects a malformed birthdate', () => {
		expect(patchBabySchema.safeParse({ birthdate: '2026-13-40' }).success).toBe(false);
	});

	it('rejects unknown fields (strict object)', () => {
		expect(patchBabySchema.safeParse({ timezone: 'America/Toronto' }).success).toBe(false);
	});
});
