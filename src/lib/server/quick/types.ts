import { z } from 'zod';

/**
 * The intent vocabulary of the quick surface (ADR 0004). A discriminated union
 * on `action`, so a new intent is one more member and one more branch in
 * `performQuick`, with nothing else to touch.
 *
 * Every member carries the same optional `babyId`: the module resolves the baby
 * on its own in a one-baby household, and this is the caller's way out of an
 * `ambiguous_baby` refusal.
 */
const babyId = { babyId: z.string().min(1).optional() };

/** The longest dictation worth echoing back in a refusal, and a cheap bound. */
export const MAX_PHRASE_LENGTH = 200;

const structuredIntents = [
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
] as const;

export const quickIntentSchema = z.discriminatedUnion('action', [
	...structuredIntents,
	// Issue #99: a free dictation, resolved against the household vocabulary
	// into one of the members above before anything is written.
	z.object({ action: z.literal('phrase'), text: z.string().max(MAX_PHRASE_LENGTH), ...babyId })
]);

export type QuickIntent = z.infer<typeof quickIntentSchema>;

/** Everything `parsePhrase` can resolve to: an intent that is not a phrase. */
export type StructuredQuickIntent = Exclude<QuickIntent, { action: 'phrase' }>;

/**
 * What a vocabulary word stands for: an intent template, without the modifiers
 * a phrase supplies (the volume of a bottle, the side of a feed). "biberon"
 * means "a bottle" — how much is in it comes from the number next to it.
 */
export const quickWordIntentSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('bottle') }),
	z.object({ action: z.literal('diaper'), kind: z.enum(['wet', 'dirty', 'both']) }),
	z.object({ action: z.literal('sleep') }),
	z.object({ action: z.literal('nursing') })
]);

export type QuickWordIntent = z.infer<typeof quickWordIntentSchema>;

export type QuickWord = {
	id: string;
	/** Stored normalised: lowercase, unaccented, one word (`normalizeWord`). */
	word: string;
	intent: QuickWordIntent;
};
