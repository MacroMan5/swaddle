import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	CATEGORY_OF,
	detailsOf,
	EVENT_TYPES,
	isPointType,
	isTimerType,
	isType,
	POINT_TYPES,
	TIMER_TYPES,
	type EventDTO,
	type EventType
} from './events';

function event(type: EventType, details: EventDTO['details']): EventDTO {
	return {
		id: `evt-${type}`,
		babyId: 'baby-1',
		caregiverId: null,
		type,
		startedAt: '2026-08-23T11:00:00.000Z',
		endedAt: null,
		note: null,
		details,
		createdAt: '2026-08-23T11:00:00.000Z',
		updatedAt: '2026-08-23T11:00:00.000Z',
		deletedAt: null
	};
}

describe('event type vocabulary', () => {
	it('partitions EVENT_TYPES into timers and point events', () => {
		expect([...TIMER_TYPES, ...POINT_TYPES].sort()).toEqual([...EVENT_TYPES].sort());
		const overlap = TIMER_TYPES.filter((t) => (POINT_TYPES as readonly string[]).includes(t));
		expect(overlap).toEqual([]);
	});

	it('gives every event type exactly one category', () => {
		expect(Object.keys(CATEGORY_OF).sort()).toEqual([...EVENT_TYPES].sort());
	});

	it('classifies every event type as a timer or a point, never both', () => {
		for (const type of EVENT_TYPES) {
			expect(isTimerType(type) !== isPointType(type)).toBe(true);
		}
	});

	it('rejects an unknown type', () => {
		expect(isTimerType('bath')).toBe(false);
		expect(isPointType('bath')).toBe(false);
	});
});

describe('isType / detailsOf', () => {
	const bottle = event('bottle', { milkType: 'formula', volumeMl: 90 });

	it('narrows on a match and refuses a mismatch', () => {
		expect(isType(bottle, 'bottle')).toBe(true);
		expect(isType(bottle, 'nursing')).toBe(false);
		if (isType(bottle, 'bottle')) expect(bottle.details.volumeMl).toBe(90);
	});

	it('returns the details for the right type', () => {
		expect(detailsOf(bottle, 'bottle')).toEqual({ milkType: 'formula', volumeMl: 90 });
		const nursing = event('nursing', {
			segments: [{ side: 'left', startedAt: '2026-08-23T11:00:00.000Z', endedAt: null }]
		});
		expect(detailsOf(nursing, 'nursing').segments).toHaveLength(1);
	});

	it('throws a TypeError for the wrong type', () => {
		expect(() => detailsOf(bottle, 'nursing')).toThrow(TypeError);
	});
});

describe('shared module stays dependency-free', () => {
	it('imports neither zod nor $lib/server', () => {
		const source = readFileSync(join(__dirname, 'events.ts'), 'utf-8');
		expect(source).not.toMatch(/from '\$lib\/server/);
		expect(source).not.toMatch(/from 'zod'/);
	});
});
