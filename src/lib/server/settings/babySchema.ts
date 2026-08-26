import { z } from 'zod';

/** Rejects calendar dates that don't exist (e.g. 2024-02-30): `Date` would
 * otherwise silently roll them over into the following month. */
function isValidCalendarDate(value: string): boolean {
	const [y, m, d] = value.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export const babyNameSchema = z.string().min(1).max(100);

/** Shared by onboarding (`POST /api/babies`) and correction
 * (`PATCH /api/babies/:id`, #46) so both entry points agree on one contract. */
export const babyBirthdateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine(isValidCalendarDate, { message: 'birthdate is not a valid calendar date' })
	.refine((d) => d <= todayIso(), { message: 'birthdate cannot be in the future' });

export const createBabySchema = z.object({
	name: babyNameSchema,
	birthdate: babyBirthdateSchema,
	timezone: z.string().min(1).optional()
});

export const patchBabySchema = z.strictObject({
	name: babyNameSchema.optional(),
	birthdate: babyBirthdateSchema.optional()
});
export type PatchBabyInput = z.infer<typeof patchBabySchema>;
