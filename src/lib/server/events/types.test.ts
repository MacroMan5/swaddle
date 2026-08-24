import { describe, it, expect } from 'vitest';
import { parseCreateEvent, parsePatchEvent } from './types';

const NOW = new Date('2026-08-23T12:00:00.000Z');
const base = {
	babyId: 'baby-1',
	type: 'bottle',
	startedAt: '2026-08-23T11:00:00.000Z',
	details: { milkType: 'formula', volumeMl: 90 }
};

describe('parseCreateEvent — FR-017 (AC-010)', () => {
	it('accepts a valid bottle', () => {
		const r = parseCreateEvent(base, NOW);
		expect(r.ok).toBe(true);
	});

	it('rejects volume 0 and 1500 ml', () => {
		for (const volumeMl of [0, 1500]) {
			const r = parseCreateEvent({ ...base, details: { milkType: 'formula', volumeMl } }, NOW);
			expect(r.ok).toBe(false);
		}
	});

	it('rejects end before start', () => {
		const r = parseCreateEvent(
			{
				...base,
				type: 'sleep',
				details: {},
				startedAt: '2026-08-23T11:00:00.000Z',
				endedAt: '2026-08-23T10:00:00.000Z'
			},
			NOW
		);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.issues.some((i) => i.code === 'end_before_start')).toBe(true);
	});

	it('rejects times more than 5 minutes in the future, accepts 4 minutes', () => {
		const bad = parseCreateEvent({ ...base, startedAt: '2026-08-23T12:10:00.000Z' }, NOW);
		expect(bad.ok).toBe(false);
		const good = parseCreateEvent({ ...base, startedAt: '2026-08-23T12:04:00.000Z' }, NOW);
		expect(good.ok).toBe(true);
	});

	it('rejects details not matching the type', () => {
		const r = parseCreateEvent({ ...base, type: 'diaper' }, NOW);
		expect(r.ok).toBe(false);
	});

	it('requires at least pee or poo on a diaper', () => {
		const r = parseCreateEvent(
			{ ...base, type: 'diaper', details: { pee: false, poo: false } },
			NOW
		);
		expect(r.ok).toBe(false);
	});

	it('requires endedAt on timer types and forbids it on point types', () => {
		const sleepOpen = parseCreateEvent({ ...base, type: 'sleep', details: {} }, NOW);
		expect(sleepOpen.ok).toBe(false); // active timers go through /api/timers
		const bottleEnded = parseCreateEvent({ ...base, endedAt: '2026-08-23T11:05:00.000Z' }, NOW);
		expect(bottleEnded.ok).toBe(false);
	});

	it('accepts a completed nursing with segments', () => {
		const r = parseCreateEvent(
			{
				babyId: 'baby-1',
				type: 'nursing',
				startedAt: '2026-08-23T10:00:00.000Z',
				endedAt: '2026-08-23T10:20:00.000Z',
				details: {
					segments: [
						{
							side: 'left',
							startedAt: '2026-08-23T10:00:00.000Z',
							endedAt: '2026-08-23T10:10:00.000Z'
						},
						{
							side: 'right',
							startedAt: '2026-08-23T10:12:00.000Z',
							endedAt: '2026-08-23T10:20:00.000Z'
						}
					]
				}
			},
			NOW
		);
		expect(r.ok).toBe(true);
	});
});

describe('parsePatchEvent', () => {
	it('accepts a partial patch', () => {
		expect(parsePatchEvent({ note: 'spit up a little' }).ok).toBe(true);
	});

	it('rejects clearing endedAt (cannot reopen a finished timer)', () => {
		expect(parsePatchEvent({ endedAt: null }).ok).toBe(false);
	});

	it('rejects unknown fields', () => {
		expect(parsePatchEvent({ type: 'sleep' }).ok).toBe(false);
	});
});

describe('nursing segment rules in context', () => {
	const nursing = (segments: unknown, endedAt: string | null = '2026-08-23T10:30:00.000Z') => ({
		babyId: 'baby-1',
		type: 'nursing',
		startedAt: '2026-08-23T10:00:00.000Z',
		...(endedAt === null ? {} : { endedAt }),
		details: { segments }
	});
	const seg = (over: object = {}) => ({
		side: 'left',
		startedAt: '2026-08-23T10:00:00.000Z',
		endedAt: '2026-08-23T10:10:00.000Z',
		...over
	});

	it('rejects an empty segment list', () => {
		const r = parseCreateEvent(nursing([]), NOW);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.issues.some((i) => i.code === 'segments_required')).toBe(true);
	});

	it('rejects a segment ending before it started', () => {
		const r = parseCreateEvent(
			nursing([seg({ startedAt: '2026-08-23T10:10:00.000Z', endedAt: '2026-08-23T10:00:00.000Z' })]),
			NOW
		);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.issues.some((i) => i.code === 'end_before_start')).toBe(true);
	});

	it('rejects an open segment that is not the last one', () => {
		const r = parseCreateEvent(nursing([seg({ endedAt: null }), seg()]), NOW);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.issues.some((i) => i.code === 'segment_still_open')).toBe(true);
	});

	it('rejects several open segments', () => {
		const r = parseCreateEvent(nursing([seg({ endedAt: null }), seg({ endedAt: null })]), NOW);
		expect(r.ok).toBe(false);
	});

	it('rejects an open segment on a completed session', () => {
		const r = parseCreateEvent(nursing([seg(), seg({ endedAt: null })]), NOW);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.issues.some((i) => i.code === 'segment_still_open')).toBe(true);
	});
});

describe('pump volume is required once completed (FR-004)', () => {
	const pump = (volumeMl: number | null) => ({
		babyId: 'baby-1',
		type: 'pump',
		startedAt: '2026-08-23T10:00:00.000Z',
		endedAt: '2026-08-23T10:20:00.000Z',
		details: { side: 'both', volumeMl }
	});

	it('rejects a completed pump without a volume', () => {
		const r = parseCreateEvent(pump(null), NOW);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.issues.some((i) => i.code === 'volume_required')).toBe(true);
	});

	it('accepts a completed pump with a volume', () => {
		expect(parseCreateEvent(pump(150), NOW).ok).toBe(true);
	});
});
