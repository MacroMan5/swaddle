import { z } from 'zod';

/**
 * The intent vocabulary of the quick surface (ADR 0004). A discriminated union
 * on `action`, so a new intent — `phrase` (issue #99) next — is one more member
 * and one more branch in `performQuick`, with nothing else to touch.
 *
 * Every member carries the same optional `babyId`: the module resolves the baby
 * on its own in a one-baby household, and this is the caller's way out of an
 * `ambiguous_baby` refusal.
 */
const babyId = { babyId: z.string().min(1).optional() };

export const quickIntentSchema = z.discriminatedUnion('action', [
	z.object({
		action: z.literal('bottle'),
		// FR-017 bounds, and integers only: volumes are stored in whole
		// millilitres, and a spoken "120,5 millilitres" helps nobody.
		volumeMl: z.number().int().min(1).max(1000),
		...babyId
	}),
	z.object({ action: z.literal('diaper'), kind: z.enum(['wet', 'dirty', 'both']), ...babyId }),
	z.object({ action: z.literal('sleep'), ...babyId }),
	z.object({ action: z.literal('nursing'), side: z.enum(['left', 'right']).optional(), ...babyId })
]);

export type QuickIntent = z.infer<typeof quickIntentSchema>;
