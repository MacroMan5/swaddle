import { describe, it, expect } from 'vitest';
import { normalizeWord, parsePhrase } from './phrase';
import type { QuickWord } from './types';

/**
 * The vocabulary migration v3 seeds. Repeated here rather than read from a
 * database: the parser is pure, and its table of cases should be readable
 * without knowing what the seed contains.
 */
const DEFAULTS: QuickWord[] = [
	{ id: 'qw-biberon', word: 'biberon', intent: { action: 'bottle' } },
	{ id: 'qw-pipi', word: 'pipi', intent: { action: 'diaper', kind: 'wet' } },
	{ id: 'qw-caca', word: 'caca', intent: { action: 'diaper', kind: 'dirty' } },
	{ id: 'qw-couche', word: 'couche', intent: { action: 'diaper', kind: 'both' } },
	{ id: 'qw-dodo', word: 'dodo', intent: { action: 'sleep' } },
	{ id: 'qw-sieste', word: 'sieste', intent: { action: 'sleep' } },
	{ id: 'qw-tetee', word: 'tetee', intent: { action: 'nursing' } },
	{ id: 'qw-teton', word: 'teton', intent: { action: 'nursing' } },
	{ id: 'qw-nene', word: 'nene', intent: { action: 'nursing' } }
];

describe('normalizeWord', () => {
	it.each([
		['Biberon', 'biberon'],
		['TÉTÉE', 'tetee'],
		['néné', 'nene'],
		['  Sieste  ', 'sieste'],
		['Ça', 'ca']
	])('normalises %s to %s', (input, expected) => {
		expect(normalizeWord(input)).toBe(expected);
	});
});

describe('parsePhrase', () => {
	it.each([
		['biberon 120', { action: 'bottle', volumeMl: 120 }],
		['biberon 120 ml', { action: 'bottle', volumeMl: 120 }],
		['biberon 120 millilitres', { action: 'bottle', volumeMl: 120 }],
		['pipi', { action: 'diaper', kind: 'wet' }],
		['caca', { action: 'diaper', kind: 'dirty' }],
		['couche', { action: 'diaper', kind: 'both' }],
		['dodo', { action: 'sleep' }],
		['sieste', { action: 'sleep' }],
		['tetee', { action: 'nursing' }],
		['teton', { action: 'nursing' }],
		['nene', { action: 'nursing' }]
	])('resolves the default word in %s', (text, intent) => {
		expect(parsePhrase(text, DEFAULTS)).toEqual(intent);
	});

	it.each([
		['NÉNÉ', { action: 'nursing' }],
		['Tétée', { action: 'nursing' }],
		['Dodo !', { action: 'sleep' }],
		['caca…', { action: 'diaper', kind: 'dirty' }],
		['« pipi »', { action: 'diaper', kind: 'wet' }],
		['biberon, 120 ml.', { action: 'bottle', volumeMl: 120 }]
	])('ignores case, accents and punctuation in %s', (text, intent) => {
		expect(parsePhrase(text, DEFAULTS)).toEqual(intent);
	});

	it.each([
		['nene gauche', 'left'],
		['nene droite', 'right'],
		['Néné à droite', 'right'],
		['tétée côté gauche', 'left'],
		// What the assistant itself says back ("Tétée côté droit démarrée"), so a
		// parent repeating it is understood.
		['tétée côté droit', 'right']
	])('reads the side out of %s', (text, side) => {
		expect(parsePhrase(text, DEFAULTS)).toEqual({ action: 'nursing', side });
	});

	it('leaves the side out when the phrase does not name one', () => {
		expect(parsePhrase('nene', DEFAULTS)).toEqual({ action: 'nursing' });
	});

	it('ignores a side on an action that has none', () => {
		expect(parsePhrase('dodo gauche', DEFAULTS)).toEqual({ action: 'sleep' });
	});

	it('ignores a number on an action that takes none', () => {
		expect(parsePhrase('couche 3', DEFAULTS)).toEqual({ action: 'diaper', kind: 'both' });
	});

	it('recognises a word in the middle of a sentence', () => {
		expect(parsePhrase('elle a fait un gros caca ce matin', DEFAULTS)).toEqual({
			action: 'diaper',
			kind: 'dirty'
		});
	});

	it('takes the first vocabulary word in the order of the text, not of the vocabulary', () => {
		expect(parsePhrase('dodo puis biberon 90', DEFAULTS)).toEqual({ action: 'sleep' });
		expect(parsePhrase('biberon 90 puis dodo', DEFAULTS)).toEqual({
			action: 'bottle',
			volumeMl: 90
		});
	});

	it('matches whole words only', () => {
		expect(parsePhrase('bibero', DEFAULTS)).toEqual({ error: 'unrecognized' });
		expect(parsePhrase('cacahuete', DEFAULTS)).toEqual({ error: 'unrecognized' });
	});

	it('recognises a synonym the household added', () => {
		const words: QuickWord[] = [
			...DEFAULTS,
			{ id: 'qw-nini', word: 'nini', intent: { action: 'nursing' } }
		];
		expect(parsePhrase('nini droite', words)).toEqual({ action: 'nursing', side: 'right' });
	});

	// Volumes are whole millilitres everywhere in the domain (FR-017): taking
	// the integer part of a dictated "120,5" would record a number nobody said.
	it.each(['biberon 120,5', 'biberon 120.5 ml', 'Biberon 0,5 millilitre'])(
		'refuses the decimal volume in %s rather than truncating it',
		(text) => {
			expect(parsePhrase(text, DEFAULTS)).toEqual({ error: 'invalid_volume' });
		}
	);

	it('still reads a whole volume next to another number', () => {
		expect(parsePhrase('biberon 120 ml a 8 h', DEFAULTS)).toEqual({
			action: 'bottle',
			volumeMl: 120
		});
	});

	it('ignores a decimal that has nothing to do with a volume', () => {
		expect(parsePhrase('dodo 1,5', DEFAULTS)).toEqual({ action: 'sleep' });
	});

	it('refuses a bottle with no number', () => {
		expect(parsePhrase('biberon', DEFAULTS)).toEqual({ error: 'missing_volume' });
		expect(parsePhrase('biberon ml', DEFAULTS)).toEqual({ error: 'missing_volume' });
	});

	it.each(['', '   ', 'bonjour', '42', 'gauche'])('refuses %s as unrecognized', (text) => {
		expect(parsePhrase(text, DEFAULTS)).toEqual({ error: 'unrecognized' });
	});

	it('refuses everything when the vocabulary is empty', () => {
		expect(parsePhrase('dodo', [])).toEqual({ error: 'unrecognized' });
	});
});
