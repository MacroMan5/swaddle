import type { QuickWord, StructuredQuickIntent } from './types';

/**
 * Free dictation, resolved against the household vocabulary (ADR 0004 § 3).
 * Pure and synchronous: no database, no clock, so the whole table of French
 * phrasings a parent may say is testable in one file.
 */

export type PhraseFailure = { error: 'unrecognized' | 'missing_volume' | 'invalid_volume' };
export type ParsedPhrase = StructuredQuickIntent | PhraseFailure;

export function isPhraseFailure(parsed: ParsedPhrase): parsed is PhraseFailure {
	return 'error' in parsed;
}

/**
 * The one spelling a word is ever compared in: lowercase, accents stripped.
 * Both halves of the feature go through it — what the settings store, and what
 * Siri heard — so « Néné » typed by a parent matches "nene" dictated later.
 */
export function normalizeWord(text: string): string {
	return text
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

/**
 * Words, in the order they were said. Everything that is not a letter or a
 * digit separates: punctuation is not part of a word, and « caca… » is "caca".
 *
 * Exported because it is the only definition of "a word" this feature has: the
 * vocabulary stores what this returns, so what a parent types can never be
 * something a dictation would split in two and never match.
 */
export function tokenize(text: string): string[] {
	return normalizeWord(text)
		.split(/[^a-z0-9]+/)
		.filter((t) => t !== '');
}

/** The two modifiers the surface understands, both fixed (never configurable). */
const SIDE_WORDS: Record<string, 'left' | 'right'> = {
	gauche: 'left',
	droite: 'right',
	// What the assistant itself says back ("Tétée côté droit démarrée").
	droit: 'right'
};

/**
 * The first number of a sentence, decimal part included, or undefined for none.
 *
 * A number counts only when it stands on its own: "8h30" holds no number the
 * parent meant as a quantity, and neither half of it is one. What follows the
 * digits is therefore checked as much as the digits themselves.
 */
function firstNumberOf(normalized: string): string | undefined {
	return normalized.match(/(?<![0-9a-z.,])\d+(?:[.,]\d+)?(?![0-9a-z])/)?.[0];
}

export function parsePhrase(text: string, words: QuickWord[]): ParsedPhrase {
	const tokens = tokenize(text);

	// By the order of the text, not of the vocabulary: "dodo puis biberon" is a
	// nap, and the parent said so first.
	const byWord = new Map(words.map((w) => [normalizeWord(w.word), w]));
	const trigger = tokens.map((t) => byWord.get(t)).find((w) => w !== undefined);
	if (trigger === undefined) return { error: 'unrecognized' };

	switch (trigger.intent.action) {
		case 'bottle': {
			// Read off the normalised text rather than the tokens: tokenising cuts
			// "120,5" into "120" and "5", which is indistinguishable from a whole
			// volume followed by another number.
			const spoken = firstNumberOf(normalizeWord(text));
			// "Biberon" alone says nothing about how much was drunk, and guessing a
			// volume is worse than asking for one.
			if (spoken === undefined) return { error: 'missing_volume' };
			// The volume is the first number said, here as everywhere else in this
			// parser — so a first number that is fractional is a fractional volume.
			// Volumes are whole millilitres throughout the domain (FR-017): asking
			// again beats recording 120 for a dictated "120,5". A decimal further
			// along (a clock time, "a 8.30") is not the volume and is ignored.
			if (/[.,]/.test(spoken)) return { error: 'invalid_volume' };
			return { action: 'bottle', volumeMl: Number(spoken) };
		}
		case 'diaper':
			return { action: 'diaper', kind: trigger.intent.kind };
		case 'sleep':
			return { action: 'sleep' };
		case 'nursing': {
			const side = tokens.map((t) => SIDE_WORDS[t]).find((s) => s !== undefined);
			// Left out when unsaid: `performQuick` then alternates from the last
			// known side, which is the better default anyway.
			return side === undefined ? { action: 'nursing' } : { action: 'nursing', side };
		}
	}
}
